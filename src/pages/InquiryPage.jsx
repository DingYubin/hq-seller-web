import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { api, exportInquiriesToFile } from '../api/client'
import {
  formatDateTime,
  formatDeadline,
  formatQuoteRate,
  inquiryStatusMeta,
  quoteRateTone,
} from '../lib/format'
import { Button, EmptyState, ErrorNote, Pagination, Spinner, StatusTag } from '../components/ui'
import QuoteModal from './QuoteModal'

const PAGE_SIZE = 20

export default function InquiryPage({ notify, reloadToken }) {
  const [keywordInput, setKeywordInput] = useState('')
  const [filters, setFilters] = useState({ keyword: '', status: '' })
  const [pageNum, setPageNum] = useState(1)
  const [list, setList] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusOptions, setStatusOptions] = useState({ items: [], total: 0 })
  const [statusLoading, setStatusLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [modal, setModal] = useState(null)
  const debounceRef = useRef(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listInquiries({
        keyword: filters.keyword || undefined,
        status: filters.status ? [filters.status] : undefined,
        pageNum,
        pageSize: PAGE_SIZE,
      })
      setList(Array.isArray(data?.list) ? data.list : [])
      setTotal(Number(data?.total) || 0)
    } catch (err) {
      setError(err.message || '询价单列表加载失败')
      setList([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [filters.keyword, filters.status, pageNum])

  const loadStatusOptions = useCallback(async () => {
    setStatusLoading(true)
    try {
      const data = await api.inquiryStatusOptions({ keyword: filters.keyword || undefined })
      setStatusOptions({ items: Array.isArray(data?.items) ? data.items : [], total: Number(data?.total) || 0 })
    } catch {
      // 角标与下拉是辅助信息，失败时静默降级，不阻塞主列表
      setStatusOptions({ items: [], total: 0 })
    } finally {
      setStatusLoading(false)
    }
  }, [filters.keyword])

  useEffect(() => {
    loadList()
  }, [loadList, reloadToken])

  // 状态选项：与搜索框同步（count 忽略已选中的 status，由服务端保证）
  useEffect(() => {
    loadStatusOptions()
  }, [loadStatusOptions, reloadToken])

  // 搜索框：回车或防抖 300ms 触发
  const applyKeyword = (value) => {
    setPageNum(1)
    setFilters((prev) => ({ ...prev, keyword: value.trim() }))
  }

  const onKeywordChange = (value) => {
    setKeywordInput(value)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => applyKeyword(value), 300)
  }

  useEffect(() => () => window.clearTimeout(debounceRef.current), [])

  const pendingCount = useMemo(() => {
    const hit = statusOptions.items.find((item) => item.value === 'PENDING')
    return hit ? Number(hit.count) || 0 : 0
  }, [statusOptions])

  const onExport = async () => {
    setExporting(true)
    try {
      await exportInquiriesToFile(filters)
      notify?.('已导出 Excel 文件', 'success')
    } catch (err) {
      notify?.(err.message || '导出失败，请重试', 'error')
    } finally {
      setExporting(false)
    }
  }

  const onRowSummary = (inquiryId, summary) => {
    setList((prev) =>
      prev.map((row) => {
        if (row.inquiryId !== inquiryId) return row
        const quotedSkuCount = Number(summary?.quotedSkuCount) || 0
        const skuCount = Number(summary?.skuCount ?? row.skuCount) || 0
        let status = row.status
        if (row.status !== 'ORDERED' && row.status !== 'EXPIRED') {
          if (quotedSkuCount <= 0) status = 'PENDING'
          else if (skuCount > 0 && quotedSkuCount >= skuCount) status = 'QUOTED'
          else status = 'PARTIALLY_QUOTED'
        }
        return {
          ...row,
          skuCount,
          quotedSkuCount,
          quoteRate: summary?.quoteRate ?? row.quoteRate,
          status,
        }
      }),
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">卖方后台 / 采购询价</div>
          <h1>
            采购询价
            <span className="pending-badge" data-testid="pending-badge">
              待报价 {pendingCount}
            </span>
          </h1>
          <p>
            询价单由买方发起，按当前渠道范围展示；未过期且未下单可「去报价」，已下单 / 已过期可查看报价并继续补充。
            报价只增不改：已提交的报价行不可修改、不可删除。
          </p>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search-box">
            <Search size={15} />
            <input
              placeholder="搜索 VIN / 保险公司 / 单号"
              value={keywordInput}
              onChange={(event) => onKeywordChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  window.clearTimeout(debounceRef.current)
                  applyKeyword(keywordInput)
                }
              }}
              data-testid="inquiry-search"
            />
          </div>
          <select
            className="filter-select"
            value={filters.status}
            onChange={(event) => {
              setPageNum(1)
              setFilters((prev) => ({ ...prev, status: event.target.value }))
            }}
            data-testid="inquiry-status-filter"
          >
            <option value="">全部状态</option>
            {statusOptions.items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <Button variant="outline" icon={Download} onClick={onExport} disabled={exporting} data-testid="inquiry-export">
            {exporting ? '导出中…' : '导出'}
          </Button>
        </div>

        {error ? <ErrorNote message={error} onRetry={loadList} /> : null}

        <div className="table-scroll">
          <table className="data-table" data-testid="inquiry-table">
            <thead>
              <tr>
                <th>询价单号</th>
                <th>保险公司</th>
                <th>定损人员</th>
                <th>联系电话</th>
                <th>品牌</th>
                <th>VIN码</th>
                <th className="num">SKU数</th>
                <th className="num">已报出</th>
                <th className="num">报出率</th>
                <th>询价时间</th>
                <th>有效期</th>
                <th>状态</th>
                <th className="ops">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="table-empty">
                    <Spinner label="询价单加载中…" />
                  </td>
                </tr>
              ) : null}
              {!loading && list.length === 0 && !error ? (
                <tr>
                  <td colSpan={13} className="table-empty">
                    <EmptyState text="暂无符合条件的询价单" />
                  </td>
                </tr>
              ) : null}
              {!loading &&
                list.map((row) => {
                  const status = inquiryStatusMeta(row.status)
                  const actions = Array.isArray(row.allowedActions) ? row.allowedActions : []
                  const canAppendQuote = actions.includes('APPEND_QUOTATION')
                  const canOpen = actions.includes('VIEW_QUOTATIONS') || canAppendQuote
                  // 原型：仅「未过期且未下单」可去报价；已下单 / 已过期进入只读明细，但仍可在弹窗里补充报价
                  const canQuoteNow = canAppendQuote && row.status !== 'ORDERED' && row.status !== 'EXPIRED'
                  return (
                    <tr key={row.inquiryId} data-testid="inquiry-row">
                      <td className="mono">{row.inquiryNo}</td>
                      <td>{row.insuranceCompanyName}</td>
                      <td>{row.adjusterName}</td>
                      <td className="mono">{row.adjusterPhoneMasked}</td>
                      <td>{row.brandName}</td>
                      <td className="mono">{row.vinMasked}</td>
                      <td className="num">{row.skuCount}</td>
                      <td className="num">{row.quotedSkuCount}</td>
                      <td className={`num rate rate-${quoteRateTone(row.quoteRate)}`} data-testid="quote-rate">
                        {formatQuoteRate(row.quoteRate)}
                      </td>
                      <td className="mono">{formatDateTime(row.publishedAt)}</td>
                      <td className="mono">{formatDeadline(row.quoteDeadlineAt)}</td>
                      <td>
                        <span data-testid="inquiry-status">
                          <StatusTag meta={status} />
                        </span>
                      </td>
                      <td className="ops">
                        {canOpen ? (
                          <button
                            type="button"
                            className={`btn btn-sm ${canQuoteNow ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() =>
                              setModal({
                                inquiryId: row.inquiryId,
                                inquiryNo: row.inquiryNo,
                                mode: canQuoteNow ? 'quote' : 'detail',
                              })
                            }
                            data-testid="inquiry-quote-action"
                          >
                            {canQuoteNow ? '去报价' : '报价明细'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>

        <Pagination pageNum={pageNum} pageSize={PAGE_SIZE} total={total} onChange={setPageNum} />
      </div>

      {modal ? (
        <QuoteModal
          inquiryId={modal.inquiryId}
          inquiryNo={modal.inquiryNo}
          mode={modal.mode}
          notify={notify}
          onClose={() => setModal(null)}
          onSubmitted={(data) => {
            onRowSummary(modal.inquiryId, data?.summary)
            setModal(null)
            notify?.('报价已保存并提交，买方端将展示本次各品质报价结果', 'success')
          }}
        />
      ) : null}
    </div>
  )
}
