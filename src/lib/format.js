// 展示格式化：时间、报出率、状态标签等（字段顺序与契约一致）

const pad = (n) => String(n).padStart(2, '0')

// 接口返回 UTC ISO，前端转本地时区，展示 MM-DD HH:mm
export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDeadline(value) {
  const text = formatDateTime(value)
  return text === '—' ? '—' : `至 ${text}`
}

// 报出率：0~1 小数，乘 100 加 %
export function formatQuoteRate(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

// ≥1 绿、0~1 橙、0 红
export function quoteRateTone(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value) || value <= 0) return 'red'
  if (value >= 1) return 'green'
  return 'orange'
}

export function remainingDays(deadline) {
  if (!deadline) return null
  const date = new Date(deadline)
  if (Number.isNaN(date.getTime())) return null
  const diff = date.getTime() - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / 86400000)
}

export const INQUIRY_STATUS = {
  PENDING: { label: '待报价', tone: 'orange' },
  PARTIALLY_QUOTED: { label: '部分报出', tone: 'orange' },
  QUOTED: { label: '已报价', tone: 'green' },
  ORDERED: { label: '已下单', tone: 'green' },
  EXPIRED: { label: '已过期', tone: 'gray' },
}

export function inquiryStatusMeta(status) {
  return INQUIRY_STATUS[status] || { label: status || '—', tone: 'gray' }
}

export const SUBJECT_TYPE = {
  HQ: { label: '总部', tone: 'blue', scopeSuffix: '总部' },
  CHANNEL: { label: '渠道', tone: 'purple', scopeSuffix: '渠道' },
  CUSTOMER: { label: '客户', tone: 'teal', scopeSuffix: '客户' },
}

export function subjectTypeMeta(type) {
  return SUBJECT_TYPE[type] || { label: type || '—', tone: 'gray', scopeSuffix: '' }
}

export const SOURCE_TYPE = {
  KAISI: { label: '开思报价', tone: 'orange' },
  HQ: { label: '华汽', tone: 'blue' },
  CHANNEL: { label: '渠道供货', tone: 'purple' },
}

export function sourceTypeMeta(type) {
  return SOURCE_TYPE[type] || { label: type || '新增', tone: 'blue' }
}

export const ROLE_STATUS = {
  ACTIVE: { label: '启用', tone: 'green' },
  INACTIVE: { label: '停用', tone: 'gray' },
}

export function roleStatusMeta(status) {
  return ROLE_STATUS[status] || { label: status || '—', tone: 'gray' }
}

// 询价单闭合原因：已下单 / 已过期
export function closedReasonText(reason) {
  if (reason === 'ORDERED') return '已下单'
  if (reason === 'EXPIRED') return '已过期'
  return reason || '—'
}

// 品质档次主数据：契约只给出 BRAND / 品牌件 与 5 个中文档次的展示名，
// 其余 4 个机器码（OEM_4S / OEM_CIRCULATION / INTERNATIONAL_BRAND / OTHER）为前端占位，
// 待后端提供品质主数据接口后改为接口下发；未知编码回落到接口返回的 qualityName。
export const QUALITY_OPTIONS = [
  { code: 'BRAND', name: '品牌件' },
  { code: 'OEM_4S', name: '4S 原厂件' },
  { code: 'OEM_CIRCULATION', name: '流通原厂件' },
  { code: 'INTERNATIONAL_BRAND', name: '国际品牌件' },
  { code: 'OTHER', name: '其他' },
]

export function qualityName(code, fallback) {
  const hit = QUALITY_OPTIONS.find((item) => item.code === code)
  return hit ? hit.name : fallback || code || '—'
}

export function joinNames(list, separator = '、') {
  if (!Array.isArray(list) || list.length === 0) return ''
  return list.map((item) => (typeof item === 'string' ? item : item?.subjectName || '')).filter(Boolean).join(separator)
}
