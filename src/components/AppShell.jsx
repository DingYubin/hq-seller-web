import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  ClipboardList,
  FileSearch,
  Headset,
  Network,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRoundCog,
} from 'lucide-react'
import { api, MOCK_USERS, getMockUser, setMockUser } from '../api/client'
import InquiryPage from '../pages/InquiryPage'
import RolePage from '../pages/RolePage'
import { EmptyState } from './ui'

// 导航 5 项：本期只实现「采购询价 / 角色管理」，其余点击进入占位页
const NAV_ITEMS = [
  { key: 'inquiries', label: '采购询价', icon: FileSearch, implemented: true },
  { key: 'orders', label: '订单清单', icon: ClipboardList, implemented: false },
  { key: 'after-sales', label: '售后处理', icon: Headset, implemented: false },
  { key: 'organization', label: '组织管理', icon: Network, implemented: false },
  { key: 'roles', label: '角色管理', icon: ShieldCheck, implemented: true },
]

const DEFAULT_ROUTE = 'inquiries'

function readRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const key = raw.split(/[?&]/)[0]
  return NAV_ITEMS.some((item) => item.key === key) ? key : DEFAULT_ROUTE
}

function PlaceholderPage({ item }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">卖方后台 / {item.label}</div>
          <h1>{item.label}</h1>
          <p>该模块不在本期内实施范围，仅保留导航入口占位。</p>
        </div>
      </div>
      <div className="card">
        <div className="empty-state" data-testid="page-placeholder">
          <TriangleAlert size={24} />
          <b>本期未实现</b>
          <span>{item.label}页面的接口契约与原型尚未冻结，待后续版本补齐。</span>
        </div>
      </div>
    </div>
  )
}

export default function AppShell() {
  const [route, setRoute] = useState(() => (typeof window === 'undefined' ? DEFAULT_ROUTE : readRoute()))
  const [mockUserValue, setMockUserValue] = useState(() => getMockUser())
  const [reloadToken, setReloadToken] = useState(0)
  const [roleAccess, setRoleAccess] = useState('unknown')
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone, key: `${Date.now()}-${Math.random()}` })
  }, [])

  const navigate = useCallback(
    (key) => {
      if (key === route) {
        // 再次点击当前项 = 重新拉取一次数据
        setReloadToken((token) => token + 1)
        return
      }
      window.location.hash = `#/${key}`
      setRoute(key)
    },
    [route],
  )

  const onChangeMockUser = (value) => {
    setMockUser(value)
    setMockUserValue(value)
    setRoleAccess('unknown')
    setReloadToken((token) => token + 1)
    notify(`已切换身份：${MOCK_USERS.find((item) => item.value === value)?.label || value}`)
  }

  const onRoleAccessDenied = useCallback(() => {
    setRoleAccess('denied')
    if (route === 'roles') {
      window.location.hash = '#/inquiries'
      setRoute('inquiries')
    }
  }, [route])

  useEffect(() => {
    let cancelled = false
    setRoleAccess('unknown')
    api
      .listRoles({ pageNum: 1, pageSize: 1 })
      .then(() => {
        if (!cancelled) setRoleAccess('allowed')
      })
      .catch((err) => {
        if (!cancelled && err.code === 40303) setRoleAccess('denied')
      })
    return () => {
      cancelled = true
    }
  }, [mockUserValue])

  useEffect(() => {
    if (roleAccess === 'denied' && route === 'roles') onRoleAccessDenied()
  }, [onRoleAccessDenied, roleAccess, route])

  const visibleNavItems = useMemo(
    () => (roleAccess === 'denied' ? NAV_ITEMS.filter((item) => item.key !== 'roles') : NAV_ITEMS),
    [roleAccess],
  )

  const activeItem = useMemo(
    () => visibleNavItems.find((item) => item.key === route) || visibleNavItems[0],
    [route, visibleNavItems],
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">华</span>
          华汽<span className="brand-dot">·</span>卖方工作台
        </div>
        <div className="top-actions">
          <label className="identity-switch">
            <UserRoundCog size={15} />
            <span className="identity-label">联调身份</span>
            <select
              value={mockUserValue}
              onChange={(event) => onChangeMockUser(event.target.value)}
              data-testid="mock-user-switch"
              title="请求头统一携带 x-mock-user"
            >
              {MOCK_USERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}（{item.value}）
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setReloadToken((token) => token + 1)}
            title="重新加载当前页"
            aria-label="重新加载当前页"
            data-testid="page-reload"
          >
            <RefreshCw size={16} />
          </button>
          <div className="user-chip">
            <span className="avatar">
              <BadgeCheck size={17} />
            </span>
            <span className="user-copy">
              <b>{MOCK_USERS.find((item) => item.value === mockUserValue)?.label || mockUserValue}</b>
              <small>{mockUserValue}</small>
            </span>
          </div>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-top">卖方后台菜单</div>
          <nav>
            {visibleNavItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === route ? 'active' : ''}
                  onClick={() => navigate(item.key)}
                  data-testid={`nav-${item.key}`}
                >
                  <Icon size={17} />
                  {item.label}
                  {item.implemented ? null : <em>未实现</em>}
                </button>
              )
            })}
          </nav>
          <div className="sidebar-foot">
            <ShieldCheck size={16} />
            <div>
              <b>接口契约驱动</b>
              <small>字段顺序 = 页面展示顺序</small>
            </div>
          </div>
        </aside>

        <main className="main-content">
          {activeItem.key === 'inquiries' ? (
            <InquiryPage notify={notify} reloadToken={reloadToken} />
          ) : null}
          {activeItem.key === 'roles' ? (
            <RolePage notify={notify} reloadToken={reloadToken} onAccessDenied={onRoleAccessDenied} />
          ) : null}
          {!activeItem.implemented ? <PlaceholderPage item={activeItem} /> : null}
        </main>
      </div>

      {toast ? (
        <div className={`toast toast-${toast.tone}`} role="status" data-testid="toast">
          {toast.tone === 'error' ? <TriangleAlert size={15} /> : <BadgeCheck size={15} />}
          <span>{toast.message}</span>
        </div>
      ) : null}
    </div>
  )
}

export { NAV_ITEMS, DEFAULT_ROUTE }
