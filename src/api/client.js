// 卖方后台 API 封装
// 契约：成功 { code: 0, message: 'ok', data }；失败仅 { code, message }
// 分页：pageNum/pageSize + data.list/data.total；写操作建议携带 Idempotency-Key
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

const MOCK_USER_KEY = 'hq-seller.mock-user'

export const MOCK_USERS = [
  { value: 'hq-admin', label: '华汽总部管理员' },
  { value: 'channel-quoter', label: '渠道报价员' },
  { value: 'mock-seller-customer', label: '客户账号（无角色管理权限）' },
]

function readStoredMockUser() {
  try {
    return window.localStorage.getItem(MOCK_USER_KEY) || 'hq-admin'
  } catch {
    return 'hq-admin'
  }
}

let mockUser = typeof window === 'undefined' ? 'hq-admin' : readStoredMockUser()

export function setMockUser(next) {
  mockUser = next
  try {
    window.localStorage.setItem(MOCK_USER_KEY, next)
  } catch {
    /* ignore */
  }
}

export function getMockUser() {
  return mockUser
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// 数组参数按契约输出为 status[]=A&status[]=B
function buildQuery(params) {
  if (!params) return ''
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null || item === '') return
        search.append(`${key}[]`, item)
      })
      return
    }
    search.append(key, value)
  })
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

async function readErrorMessage(response) {
  try {
    const payload = await response.clone().json()
    if (payload && typeof payload === 'object' && payload.message) {
      return { message: payload.message, code: payload.code }
    }
  } catch {
    /* 非 JSON 响应 */
  }
  return { message: `请求失败（HTTP ${response.status}）`, code: response.status * 100 }
}

async function request(path, { method = 'GET', body, params, idempotencyKey } = {}) {
  const headers = { 'x-mock-user': mockUser }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const response = await fetch(`${API_BASE}${path}${buildQuery(params)}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    const { message, code } = await readErrorMessage(response)
    throw new ApiError(message, code, response.status)
  }

  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object') return null
  return payload.data ?? payload
}

// 导出接口返回二进制流，失败时仍是 { code, message } JSON
async function requestBlob(path, { method = 'POST', body, idempotencyKey } = {}) {
  const headers = { 'x-mock-user': mockUser }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    const { message, code } = await readErrorMessage(response)
    throw new ApiError(message, code, response.status)
  }

  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get('content-disposition')),
  }
}

export function filenameFromDisposition(value) {
  if (!value) return ''
  const star = /filename\*\s*=\s*([^;]+)/i.exec(value)
  if (star) {
    const raw = star[1].trim().replace(/^["']|["']$/g, '')
    const encoded = raw.replace(/^(utf-8|UTF-8)''/, '')
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(value)
  return plain ? plain[1].trim() : ''
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const api = {
  // 采购询价
  listInquiries: (params) => request('/supplier/inquiries', { params }),
  inquiryStatusOptions: (params) => request('/supplier/inquiries/status-options', { params }),
  inquiryQuotations: (inquiryId, params) =>
    request(`/supplier/inquiries/${encodeURIComponent(inquiryId)}/quotations`, { params }),
  submitQuotations: (inquiryId, body, idempotencyKey) =>
    request(`/supplier/inquiries/${encodeURIComponent(inquiryId)}/quotations:submit`, {
      method: 'POST',
      body,
      idempotencyKey,
    }),
  exportInquiries: async (body, idempotencyKey) => {
    const { blob, filename } = await requestBlob('/supplier/inquiries/exports', {
      method: 'POST',
      body,
      idempotencyKey,
    })
    return { blob, filename }
  },

  // 角色管理
  listRoles: (params) => request('/roles', { params }),
  roleDetail: (roleId) => request(`/roles/${encodeURIComponent(roleId)}`),
  assignmentTargets: (params) => request('/roles/assignment-targets', { params }),
  roleUsers: (roleId, params) => request(`/roles/${encodeURIComponent(roleId)}/users`, { params }),
  listPermissions: (params) => request('/permissions', { params }),
  createRole: (body, idempotencyKey) => request('/roles', { method: 'POST', body, idempotencyKey }),
  updateRole: (roleId, body, idempotencyKey) =>
    request(`/roles/${encodeURIComponent(roleId)}`, { method: 'PATCH', body, idempotencyKey }),
  deleteRole: (roleId, version, idempotencyKey) =>
    request(`/roles/${encodeURIComponent(roleId)}`, {
      method: 'DELETE',
      params: { version },
      idempotencyKey,
    }),
}

// 统一导出下载入口：文件名优先取 Content-Disposition
export async function exportInquiriesToFile(filters) {
  const body = { format: 'XLSX' }
  if (filters.keyword) body.keyword = filters.keyword
  if (filters.status) body.status = [filters.status]
  const { blob, filename } = await api.exportInquiries(body, newIdempotencyKey())
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  triggerDownload(blob, filename || `采购询价_${stamp}.xlsx`)
}
