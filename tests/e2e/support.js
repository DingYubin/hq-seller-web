// 端到端测试公共工具：直连真实后端（/api 由 Vite 代理到 http://localhost:3001），不做任何 mock
import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

export const HQ = { 'x-mock-user': 'hq-admin' }
export const CHANNEL = { 'x-mock-user': 'channel-quoter' }

export const INQUIRY_STATUS_LABEL = {
  PENDING: '待报价',
  PARTIALLY_QUOTED: '部分报出',
  QUOTED: '已报价',
  ORDERED: '已下单',
  EXPIRED: '已过期',
}

export const SUBJECT_TYPE_LABEL = { HQ: '总部', CHANNEL: '渠道', CUSTOMER: '客户' }
export const ROLE_STATUS_LABEL = { ACTIVE: '启用', INACTIVE: '停用' }

export const INQUIRY_COLUMNS = [
  '询价单号', '保险公司', '定损人员', '联系电话', '品牌', 'VIN码',
  'SKU数', '已报出', '报出率', '询价时间', '有效期', '状态', '操作',
]

export const ROLE_COLUMNS = [
  '角色', '角色编码', '下发对象', '主体类型', '资源权限', '已绑定用户', '状态', '操作',
]

export const newKey = () => randomUUID()

export function formatRate(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

// 统一请求封装：返回状态码 + 原始包体，便于断言 { code, message } / { code, message, data }
export async function api(request, path, { method = 'GET', headers = HQ, data, idempotencyKey } = {}) {
  const finalHeaders = { ...headers }
  if (idempotencyKey) finalHeaders['Idempotency-Key'] = idempotencyKey
  if (data !== undefined) finalHeaders['Content-Type'] = 'application/json'
  const response = await request.fetch(path, { method, headers: finalHeaders, data })
  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  return { response, status: response.status(), payload, text }
}

// 成功响应：HTTP 2xx 且 code=0，返回 data
export async function apiOk(request, path, options = {}) {
  const method = options.method || 'GET'
  const result = await api(request, path, options)
  expect(
    result.response.ok(),
    `${method} ${path} 期望 HTTP 2xx，实际 HTTP ${result.status}：${result.text.slice(0, 200)}`,
  ).toBeTruthy()
  expect(result.payload?.code, `${method} ${path} 期望 code=0，实际 ${result.text.slice(0, 200)}`).toBe(0)
  return result.payload.data
}

// 失败响应：按契约只返回 { code, message }，且不含 data
export async function apiFail(request, path, expectedCode, options = {}) {
  const result = await api(request, path, options)
  expect(
    result.payload?.code,
    `${options.method || 'GET'} ${path} 期望 code=${expectedCode}，实际 HTTP ${result.status}：${result.text.slice(0, 200)}`,
  ).toBe(expectedCode)
  expect(result.payload).not.toHaveProperty('data')
  return result.payload
}

// 后端 3001 未启动时给出明确报错，而不是一堆看不懂的超时
export async function requireBackend(request) {
  let result
  try {
    result = await api(request, '/api/supplier/inquiries?pageNum=1&pageSize=1')
  } catch (error) {
    throw new Error(
      `卖方后端不可达：/api 代理目标 http://localhost:3001 连接失败（${error.message}）。` +
        '请先启动 hq-seller-service 再执行 npm run test:e2e。',
    )
  }
  if (!result.response.ok() || result.payload?.code !== 0) {
    throw new Error(
      `卖方后端未就绪：GET /api/supplier/inquiries 返回 HTTP ${result.status}，包体 ${result.text.slice(0, 200)}。` +
        '请先启动 hq-seller-service（端口 3001）再执行 npm run test:e2e。',
    )
  }
}

export async function openPage(page, route) {
  await page.goto(`/#/${route}`)
}

// 断言页面元素的 DOM 顺序（字段顺序 = 页面展示顺序）
export async function expectTestIdOrder(container, orderedTestIds) {
  const actual = await container.evaluate((node) =>
    Array.from(node.querySelectorAll('[data-testid]')).map((el) => el.dataset.testid),
  )
  const indexes = orderedTestIds.map((id) => {
    const index = actual.indexOf(id)
    expect(index, `页面缺少 data-testid=${id}`).toBeGreaterThanOrEqual(0)
    return index
  })
  const sorted = [...indexes].sort((a, b) => a - b)
  expect(indexes, `字段顺序不符合契约：期望 ${orderedTestIds.join(' → ')}，实际 ${actual.join(' → ')}`).toEqual(sorted)
}
