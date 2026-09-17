import React from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react'

export function Tag({ tone = 'gray', children, title }) {
  return (
    <span className={`tag tag-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function StatusTag({ meta }) {
  return <Tag tone={meta.tone}>{meta.label}</Tag>
}

export function Button({ variant = 'primary', size, icon: Icon, children, ...props }) {
  return (
    <button className={`btn btn-${variant}${size ? ` btn-${size}` : ''}`} {...props}>
      {Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  )
}

export function Spinner({ label = '加载中…' }) {
  return (
    <div className="spinner" role="status">
      <Loader2 size={16} className="spin" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorNote({ message, onRetry }) {
  return (
    <div className="error-note" role="alert">
      <AlertCircle size={16} />
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="link-btn" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  )
}

export function EmptyState({ text = '暂无数据' }) {
  return (
    <div className="empty-state">
      <Inbox size={22} />
      <span>{text}</span>
    </div>
  )
}

export function Modal({ title, subtitle, width = 640, onClose, footer, children, testId }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" data-testid={testId}>
        <header className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmText = '确认', danger, onConfirm, onCancel, busy }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel?.()}>
      <div className="modal confirm-modal" role="dialog" aria-modal="true" data-testid="confirm-dialog">
        <header className="modal-head">
          <div>
            <h3>{title}</h3>
          </div>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">
          <p className="confirm-text">{message}</p>
        </div>
        <footer className="modal-foot">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy} data-testid="confirm-ok">
            {busy ? '处理中…' : confirmText}
          </Button>
        </footer>
      </div>
    </div>
  )
}

export function Pagination({ pageNum, pageSize, total, onChange }) {
  const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize))
  return (
    <div className="pagination">
      <span className="pagination-info">
        第 {pageNum} / {pageCount} 页 · 共 {total || 0} 条
      </span>
      <div className="pagination-actions">
        <button
          type="button"
          className="page-btn"
          onClick={() => onChange(pageNum - 1)}
          disabled={pageNum <= 1}
          aria-label="上一页"
          data-testid="page-prev"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="page-btn"
          onClick={() => onChange(pageNum + 1)}
          disabled={pageNum >= pageCount}
          aria-label="下一页"
          data-testid="page-next"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

export function Field({ label, required, hint, error, children, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">
        {label}
        {required ? <em className="required">*</em> : null}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}
