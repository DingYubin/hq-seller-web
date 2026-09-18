import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { api } from '../api/client'
import { roleStatusMeta, subjectTypeMeta } from '../lib/format'
import { EmptyState, ErrorNote, Modal, Pagination, Spinner, StatusTag } from '../components/ui'

const PAGE_SIZE = 20

export default function RoleUsersModal({ role, onClose }) {
  const [orgInput, setOrgInput] = useState('')
  const [userInput, setUserInput] = useState('')
  const [filters, setFilters] = useState({ organizationKeyword: '', userKeyword: '' })
  const [pageNum, setPageNum] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const organizationDebounceRef = useRef(null)
  const userDebounceRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api.roleUsers(role.roleId, {
        organizationKeyword: filters.organizationKeyword || undefined,
        userKeyword: filters.userKeyword || undefined,
        pageNum,
        pageSize: PAGE_SIZE,
      })
      setData(payload)
    } catch (err) {
      setError(err.message || '已绑定用户加载失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [role.roleId, filters.organizationKeyword, filters.userKeyword, pageNum])

  useEffect(() => {
    load()
  }, [load])

  const scheduleFilters = (patch, debounceRef) => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setPageNum(1)
      setFilters((prev) => ({ ...prev, ...patch }))
    }, 300)
  }

  useEffect(
    () => () => {
      window.clearTimeout(organizationDebounceRef.current)
      window.clearTimeout(userDebounceRef.current)
    },
    [],
  )

  const roleName = data?.roleName || role.name
  const roleCode = data?.roleCode || role.code
  const subjectType = data?.subjectType || role.subjectType
  const meta = subjectTypeMeta(subjectType)
  const list = Array.isArray(data?.list) ? data.list : []
  const total = Number(data?.total) || 0

  return (
    <Modal
      width={860}
      title={`已绑定用户 · ${roleName}`}
      subtitle={`${roleCode} · ${meta.label}层级 · 共 ${total} 个账号`}
      onClose={onClose}
      testId="role-users-modal"
    >
      <div className="modal-filters">
        <div className="search-box">
          <Search size={15} />
          <input
            placeholder="按组织名称筛选"
            value={orgInput}
            onChange={(event) => {
              setOrgInput(event.target.value)
              scheduleFilters({ organizationKeyword: event.target.value.trim() }, organizationDebounceRef)
            }}
            data-testid="role-users-org-filter"
          />
        </div>
        <div className="search-box">
          <Search size={15} />
          <input
            placeholder="按用户账号 / 姓名筛选"
            value={userInput}
            onChange={(event) => {
              setUserInput(event.target.value)
              scheduleFilters({ userKeyword: event.target.value.trim() }, userDebounceRef)
            }}
            data-testid="role-users-user-filter"
          />
        </div>
      </div>

      <div className="count-line" data-testid="role-users-count">
        {list.length} / {total} 个账号
      </div>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <div className="table-scroll">
        <table className="data-table" data-testid="role-users-table">
          <thead>
            <tr>
              <th>使用组织</th>
              <th>用户姓名</th>
              <th>登录账号</th>
              <th>部门 · 岗位</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="table-empty">
                  <Spinner label="绑定用户加载中…" />
                </td>
              </tr>
            ) : null}
            {!loading && list.length === 0 && !error ? (
              <tr>
                <td colSpan={5} className="table-empty">
                  <EmptyState text="该角色暂无绑定用户" />
                </td>
              </tr>
            ) : null}
            {!loading &&
              list.map((user, index) => (
                <tr key={`${user.userName}-${user.loginAccountMasked}-${index}`} data-testid="role-users-row">
                  <td>{user.organizationName || '—'}</td>
                  <td>{user.userName || '—'}</td>
                  <td className="mono">{user.loginAccountMasked || '—'}</td>
                  <td>
                    {[user.departmentName, user.positionName].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>
                    <StatusTag meta={roleStatusMeta(user.status)} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Pagination pageNum={pageNum} pageSize={PAGE_SIZE} total={total} onChange={setPageNum} />
    </Modal>
  )
}
