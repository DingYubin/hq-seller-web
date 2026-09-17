import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api, newIdempotencyKey } from '../api/client'
import { roleStatusMeta, subjectTypeMeta } from '../lib/format'
import { Button, ErrorNote, Field, Modal, Spinner, Tag } from '../components/ui'

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/

const sameIds = (a = [], b = []) => {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

async function loadAllPermissions() {
  const pageSize = 100
  let pageNum = 1
  let collected = []
  let total = 0
  while (pageNum <= 20) {
    const data = await api.listPermissions({ includeInactive: true, pageNum, pageSize })
    const list = Array.isArray(data?.list) ? data.list : []
    collected = collected.concat(list)
    total = Number(data?.total) || 0
    if (list.length === 0 || collected.length >= total) break
    pageNum += 1
  }
  return collected
}

export default function RoleFormModal({ mode, roleId, onClose, onSaved, notify }) {
  const isEdit = mode === 'edit'
  const [form, setForm] = useState({
    name: '',
    code: '',
    subjectType: 'HQ',
    scopeMode: 'ALL',
    subjectIds: [],
    status: 'ACTIVE',
    permissionIds: [],
    remark: '',
  })
  const [detail, setDetail] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})

  const loadTargets = useCallback(async (subjectType) => {
    if (!subjectType) return
    try {
      const data = await api.assignmentTargets({ subjectType, pageNum: 1, pageSize: 100 })
      setTargets(Array.isArray(data?.list) ? data.list : [])
    } catch (err) {
      setTargets([])
      setError(err.message || '下发对象候选加载失败')
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const permissionList = await loadAllPermissions()
      setPermissions(permissionList)
      if (isEdit) {
        const data = await api.roleDetail(roleId)
        setDetail(data)
        setForm({
          name: data.name || '',
          code: data.code || '',
          subjectType: data.subjectType || 'HQ',
          scopeMode: data.scopeMode || 'ALL',
          subjectIds: Array.isArray(data.subjectIds) ? data.subjectIds : [],
          status: data.status || 'ACTIVE',
          permissionIds: Array.isArray(data.permissionIds) ? data.permissionIds : [],
          remark: data.remark || '',
        })
        if (data.scopeMode === 'CUSTOM') await loadTargets(data.subjectType)
      }
    } catch (err) {
      setLoadError(err.message || '角色数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [isEdit, roleId, loadTargets])

  useEffect(() => {
    load()
  }, [load])

  const setField = (patch) => setForm((prev) => ({ ...prev, ...patch }))

  const onSubjectTypeChange = async (next) => {
    setField({ subjectType: next, subjectIds: [] })
    setTargets([])
    if (form.scopeMode === 'CUSTOM') await loadTargets(next)
    notify?.('已清空与新主体类型不一致的下发对象', 'info')
  }

  const onScopeModeChange = async (next) => {
    if (next === 'CUSTOM' && targets.length === 0) await loadTargets(form.subjectType)
    setField({ scopeMode: next, subjectIds: next === 'ALL' ? [] : form.subjectIds })
  }

  const toggleSubject = (subjectId) => {
    setForm((prev) => ({
      ...prev,
      subjectIds: prev.subjectIds.includes(subjectId)
        ? prev.subjectIds.filter((id) => id !== subjectId)
        : [...prev.subjectIds, subjectId],
    }))
  }

  const togglePermission = (permissionId) => {
    setForm((prev) => ({
      ...prev,
      permissionIds: prev.permissionIds.includes(permissionId)
        ? prev.permissionIds.filter((id) => id !== permissionId)
        : [...prev.permissionIds, permissionId],
    }))
  }

  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = '请填写角色名称'
    if (!isEdit) {
      if (!form.code.trim()) next.code = '请填写角色编码'
      else if (!CODE_PATTERN.test(form.code.trim())) next.code = '只允许大写字母 / 数字 / 下划线，需以字母开头（2-64 位）'
    }
    if (form.scopeMode === 'CUSTOM' && form.subjectIds.length === 0) next.subjectIds = '自定义下发范围至少选择 1 个下发对象'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async () => {
    if (!validate()) return
    setSaving(true)
    setError('')
    try {
      if (!isEdit) {
        const body = {
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          subjectType: form.subjectType,
          scopeMode: form.scopeMode,
          subjectIds: form.scopeMode === 'CUSTOM' ? form.subjectIds : [],
          status: form.status,
          permissionIds: form.permissionIds,
          remark: form.remark || '',
        }
        const created = await api.createRole(body, newIdempotencyKey())
        onSaved?.(created, 'create')
        return
      }
      const patch = { version: detail?.version }
      if (form.name.trim() !== detail?.name) patch.name = form.name.trim()
      if (form.scopeMode !== detail?.scopeMode || !sameIds(form.subjectIds, detail?.subjectIds || [])) {
        patch.scopeMode = form.scopeMode
        patch.subjectIds = form.scopeMode === 'CUSTOM' ? form.subjectIds : []
      }
      if (!sameIds(form.permissionIds, detail?.permissionIds || [])) patch.permissionIds = form.permissionIds
      if ((form.remark || '') !== (detail?.remark || '')) patch.remark = form.remark || ''
      if (Object.keys(patch).length === 1) {
        notify?.('没有需要保存的改动', 'info')
        setSaving(false)
        return
      }
      const updated = await api.updateRole(roleId, patch, newIdempotencyKey())
      onSaved?.(updated, 'edit')
    } catch (err) {
      setError(err.message || '角色保存失败')
    } finally {
      setSaving(false)
    }
  }

  const subjectMeta = subjectTypeMeta(form.subjectType)
  const extraSubjects = useMemo(() => {
    if (!isEdit) return []
    const assigned = Array.isArray(detail?.assignedSubjects) ? detail.assignedSubjects : []
    return assigned.filter(
      (subject) =>
        form.subjectIds.includes(subject.subjectId) && !targets.some((item) => item.subjectId === subject.subjectId),
    )
  }, [detail, form.subjectIds, targets, isEdit])

  return (
    <Modal
      width={720}
      title={isEdit ? `编辑角色 · ${detail?.name || ''}` : '新增角色'}
      subtitle={isEdit ? '基础信息、下发范围、权限资源一次提交；编码 / 主体类型 / 状态不可在此修改' : '基础信息、下发范围、权限资源一次提交，无草稿态'}
      onClose={onClose}
      testId="role-form-modal"
      footer={
        <>
          <span className="modal-foot-hint">保存后立即对下发对象生效</span>
          <div className="quote-foot-actions">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button onClick={submit} disabled={saving || loading} data-testid="role-save">
              {saving ? '保存中…' : '保存角色'}
            </Button>
          </div>
        </>
      }
    >
      {loading ? (
        <Spinner label="角色信息加载中…" />
      ) : loadError ? (
        <ErrorNote message={loadError} onRetry={load} />
      ) : (
        <div className="form-grid">
          {error ? <ErrorNote message={error} /> : null}

          <Field label="角色名称" required error={errors.name}>
            <input
              value={form.name}
              placeholder="渠道财务人员"
              onChange={(event) => setField({ name: event.target.value })}
              data-testid="role-name"
            />
          </Field>

          <Field
            label="角色编码"
            required={!isEdit}
            error={errors.code}
            hint={isEdit ? '创建后不可修改' : '示例：CHANNEL_FINANCE，输入即转大写，创建后不可修改'}
          >
            <input
              value={form.code}
              placeholder="CHANNEL_FINANCE"
              readOnly={isEdit}
              className={isEdit ? 'readonly' : ''}
              onChange={(event) => setField({ code: event.target.value.toUpperCase() })}
              data-testid="role-code"
            />
          </Field>

          <Field label="主体类型" required hint={isEdit ? '主体类型创建后不可变更，需变更请新建角色' : '总部 / 渠道 / 客户，三者不可交叉'}>
            <select
              value={form.subjectType}
              disabled={isEdit}
              onChange={(event) => onSubjectTypeChange(event.target.value)}
              data-testid="role-subject-type"
            >
              <option value="HQ">总部</option>
              <option value="CHANNEL">渠道</option>
              <option value="CUSTOMER">客户</option>
            </select>
          </Field>

          <Field label="下发范围" required error={errors.subjectIds}>
            <div className="radio-row" data-testid="role-scope">
              <label>
                <input
                  type="radio"
                  name="scopeMode"
                  checked={form.scopeMode === 'ALL'}
                  onChange={() => onScopeModeChange('ALL')}
                  disabled={isEdit ? !detail?.allowedActions?.includes('EDIT') : false}
                />
                全部（含后续新增）
              </label>
              <label>
                <input
                  type="radio"
                  name="scopeMode"
                  checked={form.scopeMode === 'CUSTOM'}
                  onChange={() => onScopeModeChange('CUSTOM')}
                  data-testid="role-scope-custom"
                  disabled={isEdit ? !detail?.allowedActions?.includes('EDIT') : false}
                />
                自定义
              </label>
            </div>
          </Field>

          {form.scopeMode === 'CUSTOM' ? (
            <Field label={`下发对象（${subjectMeta.label}层级）`} required error={errors.subjectIds} hint="切换主体类型会清空不属于新类型的已选对象">
              <div className="checkbox-list" data-testid="role-subject-options">
                {targets.length === 0 && extraSubjects.length === 0 ? (
                  <span className="field-hint">该层级暂无可选下发对象</span>
                ) : null}
                {targets.map((target) => (
                  <label key={target.subjectId} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={form.subjectIds.includes(target.subjectId)}
                      onChange={() => toggleSubject(target.subjectId)}
                    />
                    <span>{target.subjectName}</span>
                    <em className="checkbox-hint">{subjectTypeMeta(target.subjectType).label}</em>
                  </label>
                ))}
                {extraSubjects.map((subject) => (
                  <label key={subject.subjectId} className="checkbox-item disabled">
                    <input type="checkbox" checked readOnly disabled />
                    <span>{subject.subjectName}</span>
                    <em className="checkbox-hint">已失效，保留只读</em>
                  </label>
                ))}
              </div>
            </Field>
          ) : null}

          <Field label="角色状态" hint={isEdit ? '状态在列表中通过「停用 / 启用」变更' : '默认启用'}>
            <select
              value={form.status}
              disabled={isEdit}
              onChange={(event) => setField({ status: event.target.value })}
              data-testid="role-status"
            >
              <option value="ACTIVE">启用</option>
              <option value="INACTIVE">停用</option>
            </select>
          </Field>

          <Field label="资源权限" hint="只能新勾选已启用的资源；已绑定的停用资源置灰且不可取消">
            <div className="checkbox-list" data-testid="role-permission-options">
              {permissions.length === 0 ? <span className="field-hint">暂无可配置的权限资源</span> : null}
              {permissions.map((permission) => {
                const bound = form.permissionIds.includes(permission.permissionId)
                const disabled = permission.selectable === false
                return (
                  <label
                    key={permission.permissionId}
                    className={`checkbox-item${disabled ? ' disabled' : ''}`}
                    title={permission.disabledReason || ''}
                  >
                    <input
                      type="checkbox"
                      checked={bound}
                      disabled={disabled}
                      onChange={() => togglePermission(permission.permissionId)}
                      data-testid={`role-permission-${permission.permissionId}`}
                    />
                    <span>{permission.name}</span>
                    <em className="checkbox-hint">
                      {permission.code}
                      {permission.route ? ` · ${permission.route}` : ''}
                    </em>
                    {permission.status === 'INACTIVE' ? <Tag tone="gray">已停用</Tag> : null}
                  </label>
                )
              })}
            </div>
          </Field>

          <Field label="角色说明">
            <textarea
              rows={3}
              value={form.remark}
              placeholder="负责渠道报价与客户维护"
              onChange={(event) => setField({ remark: event.target.value })}
              data-testid="role-remark"
            />
          </Field>

          {isEdit ? (
            <div className="form-meta">
              <span>角色 ID：{detail?.roleId}</span>
              <span>当前版本：{detail?.version}</span>
              <span>当前状态：{roleStatusMeta(detail?.status).label}</span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
