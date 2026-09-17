import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { api, newIdempotencyKey } from '../api/client'
import { joinNames, roleStatusMeta, subjectTypeMeta } from '../lib/format'
import { Button, ConfirmDialog, EmptyState, ErrorNote, Pagination, Spinner, StatusTag, Tag } from '../components/ui'
import RoleFormModal from './RoleFormModal'
import RoleUsersModal from './RoleUsersModal'

const PAGE_SIZE = 20

export default function RolePage({ notify, reloadToken }) {
  const [keywordInput, setKeywordInput] = useState('')
  const [filters, setFilters] = useState({ subjectType: '', subjectId: '', status: '', keyword: '' })
  const [pageNum, setPageNum] = useState(1)
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [targets, setTargets] = useState([])
  const [formModal, setFormModal] = useState(null) // { mode, roleId }
  const [usersModal, setUsersModal] = useState(null)
  const [confirm, setConfirm] = useState(null) // { type: 'toggle' | 'delete', row }
  const [confirmBusy, setConfirmBusy] = useState(false)
  const debounceRef = useRef(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listRoles({
        subjectType: filters.subjectType || undefined,
        subjectId: filters.subjectId || undefined,
        status: filters.status || undefined,
        keyword: filters.keyword || undefined,
        pageNum,
        pageSize: PAGE_SIZE,
      })
      setList(Array.isArray(data?.list) ? data.list : [])
      setTotal(Number(data?.total) || 0)
    } catch (err) {
      setError(err.message || '角色列表加载失败')
      setList([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [filters, pageNum])

  const loadTargets = useCallback(async () => {
    try {
      // 工具栏不传 subjectType = 总部 → 渠道 → 客户三级合并
      const data = await api.assignmentTargets({ pageNum: 1, pageSize: 100 })
      setTargets(Array.isArray(data?.list) ? data.list : [])
    } catch {
      setTargets([])
    }
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList, reloadToken])

  useEffect(() => {
    loadTargets()
  }, [loadTargets, reloadToken])

  useEffect(() => () => window.clearTimeout(debounceRef.current), [])

  const updateFilter = (patch, { resetPage = true } = {}) => {
    if (resetPage) setPageNum(1)
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  const onKeywordChange = (value) => {
    setKeywordInput(value)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => updateFilter({ keyword: value.trim() }), 300)
  }

  const replaceRow = (row) => {
    setList((prev) => prev.map((item) => (item.roleId === row.roleId ? row : item)))
  }

  const onToggle = async () => {
    const row = confirm?.row
    if (!row) return
    const nextStatus = row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    setConfirmBusy(true)
    try {
      const updated = await api.updateRole(row.roleId, { status: nextStatus, version: row.version }, newIdempotencyKey())
      replaceRow(updated)
      notify?.(nextStatus === 'ACTIVE' ? '角色已启用' : '角色已停用', 'success')
      setConfirm(null)
    } catch (err) {
      notify?.(err.message || '状态变更失败', 'error')
      setConfirm(null)
      if (err.status === 409) loadList()
    } finally {
      setConfirmBusy(false)
    }
  }

  const onDelete = async () => {
    const row = confirm?.row
    if (!row) return
    setConfirmBusy(true)
    try {
      await api.deleteRole(row.roleId, row.version, newIdempotencyKey())
      notify?.('角色已删除', 'success')
      setConfirm(null)
      if (list.length === 1 && pageNum > 1) setPageNum(pageNum - 1)
      else loadList()
    } catch (err) {
      notify?.(err.message || '角色删除失败', 'error')
      setConfirm(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">卖方后台 / 角色管理</div>
          <h1>角色管理</h1>
          <p>角色由华汽总部统一创建并下发；停用不等于解绑，下发对象与用户绑定全部保留。</p>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <select
            className="filter-select"
            value={filters.subjectType}
            onChange={(event) => updateFilter({ subjectType: event.target.value, subjectId: '' })}
            data-testid="role-subject-type-filter"
          >
            <option value="">全部主体类型</option>
            <option value="HQ">总部</option>
            <option value="CHANNEL">渠道</option>
            <option value="CUSTOMER">客户</option>
          </select>
          <select
            className="filter-select wide"
            value={filters.subjectId}
            onChange={(event) => updateFilter({ subjectId: event.target.value })}
            data-testid="role-subject-filter"
          >
            <option value="">全部下发对象</option>
            {targets.map((target) => (
              <option key={target.subjectId} value={target.subjectId}>
                {target.subjectName}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={filters.status}
            onChange={(event) => updateFilter({ status: event.target.value })}
            data-testid="role-status-filter"
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">启用</option>
            <option value="INACTIVE">停用</option>
          </select>
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder="搜索角色名称 / 编码"
              value={keywordInput}
              onChange={(event) => onKeywordChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  window.clearTimeout(debounceRef.current)
                  updateFilter({ keyword: keywordInput.trim() })
                }
              }}
              data-testid="role-search"
            />
          </div>
          <div className="toolbar-tail">
            <Button icon={Plus} onClick={() => setFormModal({ mode: 'create' })} data-testid="role-create">
              新增角色
            </Button>
          </div>
        </div>

        {error ? <ErrorNote message={error} onRetry={loadList} /> : null}

        <div className="table-scroll">
          <table className="data-table" data-testid="role-table">
            <thead>
              <tr>
                <th>角色</th>
                <th>角色编码</th>
                <th>下发对象</th>
                <th>主体类型</th>
                <th>资源权限</th>
                <th className="num">已绑定用户</th>
                <th>状态</th>
                <th className="ops">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="table-empty">
                    <Spinner label="角色加载中…" />
                  </td>
                </tr>
              ) : null}
              {!loading && list.length === 0 && !error ? (
                <tr>
                  <td colSpan={8} className="table-empty">
                    <EmptyState text="暂无符合条件的角色" />
                  </td>
                </tr>
              ) : null}
              {!loading &&
                list.map((row) => {
                  const actions = Array.isArray(row.allowedActions) ? row.allowedActions : []
                  const meta = subjectTypeMeta(row.subjectType)
                  const scopeNames = joinNames(row.assignedSubjects)
                  return (
                    <tr key={row.roleId} data-testid="role-row">
                      <td className="strong">{row.name}</td>
                      <td className="mono">{row.code}</td>
                      <td className="scope-cell">
                        <div>{row.scopeLabel || '—'}</div>
                        {row.scopeMode === 'CUSTOM' && scopeNames && scopeNames !== row.scopeLabel ? (
                          <div className="sub-line">{scopeNames}</div>
                        ) : null}
                      </td>
                      <td>
                        <Tag tone={meta.tone}>{meta.label}</Tag>
                      </td>
                      <td>
                        <div className="tag-flow" data-testid="role-permissions">
                          {Array.isArray(row.permissions) && row.permissions.length > 0 ? (
                            row.permissions.map((permission) => (
                              <Tag
                                key={permission.permissionId}
                                tone={permission.status === 'INACTIVE' ? 'gray' : 'light'}
                                title={permission.code}
                              >
                                {permission.name}
                                {permission.status === 'INACTIVE' ? ' · 已停用' : ''}
                              </Tag>
                            ))
                          ) : (
                            <span className="muted">无功能资源</span>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        {actions.includes('VIEW_USERS') ? (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() =>
                              setUsersModal({
                                roleId: row.roleId,
                                name: row.name,
                                code: row.code,
                                subjectType: row.subjectType,
                              })
                            }
                            data-testid="role-users-link"
                          >
                            {row.userCount} 人
                          </button>
                        ) : (
                          `${row.userCount} 人`
                        )}
                      </td>
                      <td>
                        <span data-testid="role-status">
                          <StatusTag meta={roleStatusMeta(row.status)} />
                        </span>
                      </td>
                      <td className="ops">
                        <div className="row-actions">
                          {actions.includes('EDIT') ? (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => setFormModal({ mode: 'edit', roleId: row.roleId })}
                              data-testid="role-edit"
                            >
                              编辑
                            </button>
                          ) : null}
                          {actions.includes('TOGGLE_STATUS') ? (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => setConfirm({ type: 'toggle', row })}
                              data-testid="role-toggle"
                            >
                              {row.status === 'ACTIVE' ? '停用' : '启用'}
                            </button>
                          ) : null}
                          {actions.includes('DELETE') ? (
                            <button
                              type="button"
                              className="link-btn danger"
                              onClick={() => setConfirm({ type: 'delete', row })}
                              data-testid="role-delete"
                            >
                              删除
                            </button>
                          ) : null}
                          {actions.length === 0 ? <span className="muted">—</span> : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>

        <Pagination pageNum={pageNum} pageSize={PAGE_SIZE} total={total} onChange={setPageNum} />
      </div>

      {formModal ? (
        <RoleFormModal
          mode={formModal.mode}
          roleId={formModal.roleId}
          notify={notify}
          onClose={() => setFormModal(null)}
          onSaved={(row, kind) => {
            setFormModal(null)
            notify?.(kind === 'create' ? '角色创建成功' : '角色保存成功', 'success')
            if (row && row.roleId) replaceRow(row)
            loadList()
          }}
        />
      ) : null}

      {usersModal ? <RoleUsersModal role={usersModal} onClose={() => setUsersModal(null)} /> : null}

      {confirm?.type === 'toggle' ? (
        <ConfirmDialog
          title={confirm.row.status === 'ACTIVE' ? '停用角色' : '启用角色'}
          message={
            confirm.row.status === 'ACTIVE'
              ? `停用「${confirm.row.name}」后角色立即不生效，但下发对象、权限与用户绑定全部保留。`
              : `启用「${confirm.row.name}」后，已绑定的用户立即恢复该角色的权限。`
          }
          confirmText={confirm.row.status === 'ACTIVE' ? '确认停用' : '确认启用'}
          busy={confirmBusy}
          onConfirm={onToggle}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {confirm?.type === 'delete' ? (
        <ConfirmDialog
          title="删除角色"
          message={`删除「${confirm.row.name}」后，各组织 / 客户的可用角色立即不再出现它；已绑定用户的角色请先在「用户管理」调整。删除不做级联。`}
          confirmText="确认删除"
          danger
          busy={confirmBusy}
          onConfirm={onDelete}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  )
}
