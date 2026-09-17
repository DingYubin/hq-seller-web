import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, newIdempotencyKey } from '../api/client'
import {
  QUALITY_OPTIONS,
  closedReasonText,
  formatDateTime,
  formatQuoteRate,
  qualityName,
  remainingDays,
  sourceTypeMeta,
} from '../lib/format'
import { Button, ErrorNote, Modal, Spinner, Tag } from '../components/ui'

const localLineId = () => `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const isEmpty = (value) => value === undefined || value === null || value === ''

function makeOffer(item) {
  return {
    key: localLineId(),
    clientLineId: localLineId(),
    quoteLineId: null,
    sourceType: null,
    supplierName: '',
    unitPrice: '',
    availableQuantity: String(item.quantity ?? ''),
    leadTimeDays: '',
    note: '',
    version: null,
    editable: true,
    isNew: true,
  }
}

function buildModel(data) {
  return (data.items || []).map((item) => ({
    inquiryItemId: item.inquiryItemId,
    partName: item.partName,
    oeCode: item.oeCode,
    quantity: item.quantity,
    groups: (item.qualities || []).map((quality) => ({
      key: `g_${item.inquiryItemId}_${quality.qualityCode}`,
      qualityCode: quality.qualityCode,
      qualityName: quality.qualityName,
      isNew: false,
      offers: (quality.offers || []).map((offer) => ({
        key: offer.quoteLineId || localLineId(),
        clientLineId: null,
        quoteLineId: offer.quoteLineId,
        sourceType: offer.sourceType,
        supplierName: offer.supplierName ?? '',
        unitPrice: offer.unitPrice ?? '',
        availableQuantity: isEmpty(offer.availableQuantity) ? '' : String(offer.availableQuantity),
        leadTimeDays: isEmpty(offer.leadTimeDays) ? '' : String(offer.leadTimeDays),
        note: '',
        version: offer.version ?? null,
        editable: offer.editable !== false,
        isNew: false,
        original: {
          supplierName: offer.supplierName ?? '',
          unitPrice: String(offer.unitPrice ?? ''),
          availableQuantity: isEmpty(offer.availableQuantity) ? '' : String(offer.availableQuantity),
          leadTimeDays: isEmpty(offer.leadTimeDays) ? '' : String(offer.leadTimeDays),
        },
      })),
    })),
  }))
}

function isDirty(offer) {
  if (offer.isNew || !offer.original) return false
  return (
    offer.unitPrice !== offer.original.unitPrice ||
    offer.availableQuantity !== offer.original.availableQuantity ||
    offer.leadTimeDays !== offer.original.leadTimeDays
  )
}

export default function QuoteModal({ inquiryId, inquiryNo, onClose, onSubmitted, notify }) {
  const [detail, setDetail] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const idemRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await api.inquiryQuotations(inquiryId)
      setDetail(data)
      setItems(buildModel(data))
    } catch (error) {
      setLoadError(error.message || '报价明细加载失败')
    } finally {
      setLoading(false)
    }
  }, [inquiryId])

  useEffect(() => {
    load()
  }, [load])

  const canEditExisting = Boolean(detail?.inquiry?.canEditExistingQuotes)
  const canAppend = Boolean(detail?.inquiry?.canAppendQuotes)

  const qualityChoices = useMemo(() => {
    const seen = new Map(QUALITY_OPTIONS.map((item) => [item.code, item]))
    items.forEach((item) =>
      item.groups.forEach((group) => {
        if (!seen.has(group.qualityCode)) {
          seen.set(group.qualityCode, { code: group.qualityCode, name: qualityName(group.qualityCode, group.qualityName) })
        }
      }),
    )
    return [...seen.values()]
  }, [items])

  const updateOffer = (itemIdx, groupIdx, offerIdx, patch) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i !== itemIdx
          ? item
          : {
              ...item,
              groups: item.groups.map((group, j) =>
                j !== groupIdx
                  ? group
                  : {
                      ...group,
                      offers: group.offers.map((offer, k) => (k === offerIdx ? { ...offer, ...patch } : offer)),
                    },
              ),
            },
      ),
    )
  }

  const addOffer = (itemIdx, groupIdx) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i !== itemIdx
          ? item
          : {
              ...item,
              groups: item.groups.map((group, j) =>
                j === groupIdx ? { ...group, offers: [...group.offers, makeOffer(item)] } : group,
              ),
            },
      ),
    )
  }

  const addQuality = (itemIdx) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== itemIdx) return item
        const used = new Set(item.groups.map((group) => group.qualityCode))
        const next = QUALITY_OPTIONS.find((option) => !used.has(option.code)) || QUALITY_OPTIONS[0]
        return {
          ...item,
          groups: [
            ...item.groups,
            {
              key: localLineId(),
              qualityCode: next.code,
              qualityName: next.name,
              isNew: true,
              offers: [makeOffer(item)],
            },
          ],
        }
      }),
    )
  }

  const removeOffer = (itemIdx, groupIdx, offerIdx) => {
    setItems((prev) =>
      prev
        .map((item, i) => {
          if (i !== itemIdx) return item
          return {
            ...item,
            groups: item.groups
              .map((group, j) =>
                j !== groupIdx
                  ? group
                  : { ...group, offers: group.offers.filter((_, k) => k !== offerIdx) },
              )
              .filter((group) => group.offers.length > 0),
          }
        })
        .filter((item) => item.groups.length > 0),
    )
  }

  // 「改品质」：按新品质重新提交（老品质行服务端保留，没有删除接口）
  const changeQuality = (itemIdx, groupIdx, code) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i !== itemIdx
          ? item
          : {
              ...item,
              groups: item.groups.map((group, j) => {
                if (j !== groupIdx) return group
                const name = qualityName(code, code)
                return {
                  ...group,
                  qualityCode: code,
                  qualityName: name,
                  isNew: true,
                  offers: group.offers.map((offer) => ({
                    ...offer,
                    isNew: true,
                    quoteLineId: null,
                    version: null,
                    original: undefined,
                    clientLineId: offer.clientLineId || localLineId(),
                  })),
                }
              }),
            },
      ),
    )
  }

  const buildPayload = () => {
    const lines = []
    let invalid = ''
    items.forEach((item) => {
      item.groups.forEach((group) => {
        group.offers.forEach((offer) => {
          if (offer.isNew) {
            if (!offer.supplierName.trim()) {
              invalid = invalid || `请填写「${item.partName} · ${qualityName(group.qualityCode, group.qualityName)}」的商家名称`
              return
            }
            if (!/^\d+(\.\d{1,2})?$/.test(offer.unitPrice.trim())) {
              invalid = invalid || `请填写「${item.partName} · ${qualityName(group.qualityCode, group.qualityName)}」的正确单价`
              return
            }
            const line = {
              clientLineId: offer.clientLineId,
              inquiryItemId: item.inquiryItemId,
              qualityCode: group.qualityCode,
              supplierName: offer.supplierName.trim(),
              unitPrice: offer.unitPrice.trim(),
            }
            if (offer.availableQuantity !== '') line.availableQuantity = Number(offer.availableQuantity)
            if (offer.leadTimeDays !== '') line.leadTimeDays = Number(offer.leadTimeDays)
            if (offer.note) line.note = offer.note
            lines.push(line)
            return
          }
          if (isDirty(offer)) {
            const line = { quoteLineId: offer.quoteLineId, unitPrice: offer.unitPrice.trim(), version: offer.version }
            if (offer.availableQuantity !== '') line.availableQuantity = Number(offer.availableQuantity)
            if (offer.leadTimeDays !== '') line.leadTimeDays = Number(offer.leadTimeDays)
            lines.push(line)
          }
        })
      })
    })
    return { lines, invalid }
  }

  const submit = async () => {
    const { lines, invalid } = buildPayload()
    if (invalid) {
      setSubmitError(invalid)
      return
    }
    if (lines.length === 0) {
      setSubmitError('没有需要提交的改动：请新增报价行，或修改已有行的单价')
      return
    }
    const signature = JSON.stringify(lines)
    const key = idemRef.current && idemRef.current.signature === signature ? idemRef.current.key : newIdempotencyKey()
    idemRef.current = { key, signature }
    setSubmitting(true)
    setSubmitError('')
    try {
      const data = await api.submitQuotations(inquiryId, { items: lines }, key)
      onSubmitted?.(data)
    } catch (error) {
      setSubmitError(error.message || '提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  // 崩溃/冲突后重新拉明细（丢弃本地未提交输入）
  const reload = async () => {
    idemRef.current = null
    await load()
    notify?.('已重新拉取报价明细，请基于最新数据确认后再提交')
  }

  const inquiry = detail?.inquiry
  const summary = detail?.summary
  const mainText = canEditExisting ? '保存并提交报价' : '保存新增报价'
  const showMainButton = canAppend || canEditExisting

  const deadlineText = (() => {
    if (!inquiry) return ''
    if (canEditExisting) {
      const days = remainingDays(inquiry.quoteDeadlineAt)
      const suffix = days === null ? '' : `（剩余 ${days} 天）`
      return `有效至 ${formatDateTime(inquiry.quoteDeadlineAt)}${suffix}`
    }
    return closedReasonText(inquiry.closedReason || inquiry.status)
  })()

  const title = `${canEditExisting ? '去报价' : '报价明细'} · ${inquiryNo || inquiry?.inquiryNo || ''}`

  return (
    <Modal
      width={1120}
      title={title}
      onClose={onClose}
      testId="quote-modal"
      footer={
        <div className="quote-foot">
          <span className="quote-foot-hint">
            {canEditExisting
              ? '本次修改行与新增行一并提交，提交后买方端立即可见'
              : '历史报价只读，本次仅提交新增报价行'}
            {summary ? ` · 当前报出率 ${formatQuoteRate(summary.quoteRate)}` : ''}
          </span>
          <div className="quote-foot-actions">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            {showMainButton ? (
              <Button onClick={submit} disabled={submitting} data-testid="quote-submit">
                {submitting ? '提交中…' : mainText}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {loading ? (
        <Spinner label="报价明细加载中…" />
      ) : loadError ? (
        <ErrorNote message={loadError} onRetry={load} />
      ) : (
        <>
          {submitError ? (
            <div className="modal-error" role="alert" data-testid="quote-error">
              <span>{submitError}</span>
              <button type="button" className="link-btn" onClick={reload}>
                <RefreshCw size={13} /> 重新加载明细
              </button>
            </div>
          ) : null}

          <div className="quote-head" data-testid="quote-modal-header">
            <div>
              <span>保险公司</span>
              <b>{inquiry?.insuranceCompanyName || '—'}</b>
            </div>
            <div>
              <span>定损人员</span>
              <b>
                {inquiry?.adjusterName || '—'}
                {inquiry?.adjusterPhoneMasked ? `（${inquiry.adjusterPhoneMasked}）` : ''}
              </b>
            </div>
            <div>
              <span>车型</span>
              <b>{inquiry?.vehicleModelName || '—'}</b>
            </div>
            <div>
              <span>VIN</span>
              <b>{inquiry?.vinMasked || '—'}</b>
            </div>
            <div>
              <span>归属渠道</span>
              <b>{inquiry?.owningChannelName || '—'}</b>
            </div>
            <div>
              <span>有效期 / 结束原因</span>
              <b>{deadlineText || '—'}</b>
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table quote-table" data-testid="quote-table">
              <thead>
                <tr>
                  <th style={{ width: 46 }}>#</th>
                  <th>配件名称</th>
                  <th>OE号</th>
                  <th style={{ width: 66 }}>数量</th>
                  <th style={{ width: 168 }}>品质档次</th>
                  <th>金额-供应商</th>
                  <th style={{ width: 210 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      该询价单暂无可报价的配件行
                    </td>
                  </tr>
                ) : null}
                {items.map((item, itemIdx) => {
                  // 待报价 / 未报价的 SKU 还没有任何品质行，也必须保留「新增报价（新品质）」入口
                  if (item.groups.length === 0) {
                    return (
                      <tr key={`empty_${item.inquiryItemId}`} data-testid="quote-row-empty">
                        <td>{itemIdx + 1}</td>
                        <td>{item.partName}</td>
                        <td>{item.oeCode || '—'}</td>
                        <td>{item.quantity}</td>
                        <td className="muted">未选品质</td>
                        <td className="muted">尚未报价</td>
                        <td>
                          <div className="row-actions">
                            {canAppend ? (
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => addQuality(itemIdx)}
                                data-testid="quote-add-new-quality"
                              >
                                <Plus size={13} /> 新增报价（新品质）
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return item.groups.map((group, groupIdx) => {
                    const usedCodes = new Set(item.groups.map((g) => g.qualityCode))
                    return group.offers.map((offer, offerIdx) => {
                      const isItemFirst = groupIdx === 0 && offerIdx === 0
                      const isGroupFirst = offerIdx === 0
                      const editableExisting = !offer.isNew && canEditExisting && offer.editable
                      const dirty = isDirty(offer)
                      const source = sourceTypeMeta(offer.sourceType)
                      return (
                        <tr
                          key={offer.key}
                          className={offer.isNew ? 'row-new' : !offer.editable ? 'row-locked' : ''}
                          data-testid={offer.isNew ? 'quote-row-new' : 'quote-row-history'}
                        >
                          {isItemFirst ? (
                            <>
                              <td rowSpan={item.groups.reduce((sum, g) => sum + g.offers.length, 0)}>{itemIdx + 1}</td>
                              <td rowSpan={item.groups.reduce((sum, g) => sum + g.offers.length, 0)}>
                                {item.partName}
                              </td>
                              <td rowSpan={item.groups.reduce((sum, g) => sum + g.offers.length, 0)}>
                                {item.oeCode || '—'}
                              </td>
                              <td rowSpan={item.groups.reduce((sum, g) => sum + g.offers.length, 0)}>
                                {item.quantity}
                              </td>
                            </>
                          ) : null}
                          {isGroupFirst ? (
                            <td rowSpan={group.offers.length}>
                              {group.isNew ? (
                                <select
                                  value={group.qualityCode}
                                  onChange={(event) => changeQuality(itemIdx, groupIdx, event.target.value)}
                                  data-testid="quote-quality-select"
                                >
                                  {qualityChoices.map((option) => (
                                    <option
                                      key={option.code}
                                      value={option.code}
                                      disabled={usedCodes.has(option.code) && option.code !== group.qualityCode}
                                    >
                                      {option.name}
                                    </option>
                                  ))}
                                </select>
                              ) : canEditExisting && group.offers.some((row) => row.editable) ? (
                                <span className="quality-edit">
                                  <select
                                    value={group.qualityCode}
                                    onChange={(event) => changeQuality(itemIdx, groupIdx, event.target.value)}
                                    title="改品质将按新品质重新提交，原品质报价行保留"
                                    data-testid="quote-quality-select"
                                  >
                                    {qualityChoices.map((option) => (
                                      <option
                                        key={option.code}
                                        value={option.code}
                                        disabled={usedCodes.has(option.code) && option.code !== group.qualityCode}
                                      >
                                        {option.name}
                                      </option>
                                    ))}
                                  </select>
                                </span>
                              ) : (
                                qualityName(group.qualityCode, group.qualityName)
                              )}
                            </td>
                          ) : null}
                          <td>
                            <div className="offer-cell">
                              <div className="offer-line">
                                <Tag tone={offer.isNew ? 'blue' : source.tone}>{offer.isNew ? '新增' : source.label}</Tag>
                                {offer.isNew ? (
                                  <input
                                    className="offer-supplier"
                                    placeholder="商家名称"
                                    value={offer.supplierName}
                                    onChange={(event) =>
                                      updateOffer(itemIdx, groupIdx, offerIdx, { supplierName: event.target.value })
                                    }
                                    data-testid="quote-supplier-input"
                                  />
                                ) : (
                                  <span className="offer-supplier-text">{offer.supplierName || '—'}</span>
                                )}
                                <span className="price-box">
                                  <span className="price-symbol">¥</span>
                                  <input
                                    className="offer-price"
                                    placeholder="单价"
                                    inputMode="decimal"
                                    value={offer.unitPrice}
                                    disabled={!offer.isNew && !editableExisting}
                                    onChange={(event) =>
                                      updateOffer(itemIdx, groupIdx, offerIdx, { unitPrice: event.target.value })
                                    }
                                    data-testid="quote-price-input"
                                  />
                                </span>
                                {dirty ? <Tag tone="orange">已改价</Tag> : null}
                              </div>
                              <div className="offer-line offer-extra">
                                <label>
                                  可售
                                  <input
                                    value={offer.availableQuantity}
                                    disabled={!offer.isNew && !editableExisting}
                                    onChange={(event) =>
                                      updateOffer(itemIdx, groupIdx, offerIdx, { availableQuantity: event.target.value })
                                    }
                                  />
                                </label>
                                <label>
                                  货期
                                  <input
                                    value={offer.leadTimeDays}
                                    placeholder="天"
                                    disabled={!offer.isNew && !editableExisting}
                                    onChange={(event) =>
                                      updateOffer(itemIdx, groupIdx, offerIdx, { leadTimeDays: event.target.value })
                                    }
                                  />
                                </label>
                                {!offer.isNew && !editableExisting ? <em className="locked-hint">已锁定，不可修改</em> : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="row-actions">
                              {offer.isNew ? (
                                <button
                                  type="button"
                                  className="link-btn danger"
                                  onClick={() => removeOffer(itemIdx, groupIdx, offerIdx)}
                                  data-testid="quote-delete-line"
                                >
                                  <Trash2 size={13} /> 删除
                                </button>
                              ) : null}
                              {isGroupFirst && canAppend ? (
                                <button
                                  type="button"
                                  className="link-btn"
                                  onClick={() => addOffer(itemIdx, groupIdx)}
                                  data-testid="quote-add-same-quality"
                                >
                                  <Plus size={13} /> 新增报价（同品质）
                                </button>
                              ) : null}
                              {isItemFirst && canAppend ? (
                                <button
                                  type="button"
                                  className="link-btn"
                                  onClick={() => addQuality(itemIdx)}
                                  data-testid="quote-add-new-quality"
                                >
                                  <Plus size={13} /> 新增报价（新品质）
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  })
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}
