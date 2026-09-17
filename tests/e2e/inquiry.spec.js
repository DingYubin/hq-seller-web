// 采购询价页端到端用例：全部断言基于真实接口返回
import { expect, test } from '@playwright/test'
import {
  CHANNEL,
  HQ,
  INQUIRY_COLUMNS,
  INQUIRY_STATUS_LABEL,
  apiOk,
  formatRate,
  newKey,
  openPage,
  requireBackend,
} from './support.js'

test.describe('采购询价', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('询价列表加载：13 列按契约顺序渲染，且携带 x-mock-user', async ({ page, request }) => {
    const sentMockUsers = []
    page.on('request', (req) => {
      if (req.url().includes('/api/supplier/inquiries') && !req.url().includes('status-options')) {
        sentMockUsers.push(req.headers()['x-mock-user'])
      }
    })

    const data = await apiOk(request, '/api/supplier/inquiries?pageNum=1&pageSize=20')
    expect(data.list.length, '需要后端 seed 至少 1 条询价单（列表用例依赖真实数据）').toBeGreaterThan(0)

    await openPage(page, 'inquiries')

    await expect(page.getByTestId('inquiry-table').locator('thead th')).toHaveText(INQUIRY_COLUMNS)
    await expect(page.getByTestId('inquiry-row')).toHaveCount(data.list.length)

    // 逐列核对第 1 行与接口字段一致（字段顺序=页面顺序）
    const first = data.list[0]
    const cells = page.getByTestId('inquiry-row').first().locator('td')
    await expect(cells.nth(0)).toHaveText(first.inquiryNo)
    await expect(cells.nth(1)).toHaveText(first.insuranceCompanyName)
    await expect(cells.nth(2)).toHaveText(first.adjusterName)
    await expect(cells.nth(3)).toHaveText(first.adjusterPhoneMasked)
    await expect(cells.nth(4)).toHaveText(first.brandName)
    await expect(cells.nth(5)).toHaveText(first.vinMasked)
    await expect(cells.nth(6)).toHaveText(String(first.skuCount))
    await expect(cells.nth(7)).toHaveText(String(first.quotedSkuCount))
    await expect(page.getByTestId('quote-rate').first()).toHaveText(formatRate(first.quoteRate))
    await expect(cells.nth(11)).toHaveText(INQUIRY_STATUS_LABEL[first.status])

    // 时间由 UTC 转本地 MM-DD HH:mm
    const published = new Date(first.publishedAt)
    const pad = (n) => String(n).padStart(2, '0')
    const expectedTime = `${pad(published.getMonth() + 1)}-${pad(published.getDate())} ${pad(published.getHours())}:${pad(published.getMinutes())}`
    await expect(cells.nth(9)).toHaveText(expectedTime)

    expect(sentMockUsers.length, '列表请求应至少发出一次').toBeGreaterThan(0)
    expect(sentMockUsers.every((value) => value === 'hq-admin'), 'API 层应统一携带 x-mock-user: hq-admin').toBe(true)
  })

  test('状态选项与筛选：角标取 PENDING.count，切换下拉后列表等于该筛选的真实结果', async ({ page, request }) => {
    const options = await apiOk(request, '/api/supplier/inquiries/status-options')
    const pending = options.items.find((item) => item.value === 'PENDING')
    expect(pending, '状态选项接口必须返回 PENDING（待报价角标依赖它）').toBeTruthy()

    await openPage(page, 'inquiries')
    await expect(page.getByTestId('pending-badge')).toHaveText(`待报价 ${pending.count}`)

    // 下拉 = 本地「全部状态」+ 接口选项
    const filter = page.getByTestId('inquiry-status-filter')
    await expect(filter.locator('option')).toHaveText(['全部状态', ...options.items.map((item) => item.label)])

    const target = options.items[0]
    const expected = await apiOk(
      request,
      `/api/supplier/inquiries?status[]=${encodeURIComponent(target.value)}&pageNum=1&pageSize=20`,
    )
    await filter.selectOption(target.value)
    await expect(page.getByTestId('inquiry-row')).toHaveCount(expected.list.length)
    if (expected.list.length > 0) {
      await expect(page.getByTestId('inquiry-status').first()).toHaveText(INQUIRY_STATUS_LABEL[target.value])
    }
    await expect(page.getByTestId('pending-badge')).toHaveText(`待报价 ${pending.count}`)
  })

  test('待报价单直接在未报价 SKU 上新增报价：只提交本次新增行，成功后用 summary 就地刷新', async ({ page, request }) => {
    const list = await apiOk(request, '/api/supplier/inquiries?pageNum=1&pageSize=50')
    // 待报价单仍有未报价 SKU，报价弹窗必须能直接新增行（原型：报价可反复追加，无草稿态）
    const target = list.list.find(
      (row) =>
        (row.allowedActions || []).includes('APPEND_QUOTATION') &&
        !['ORDERED', 'EXPIRED'].includes(row.status) &&
        row.quotedSkuCount < row.skuCount,
    )
    test.skip(!target, '后端需要至少 1 条未过期未下单、允许追加报价且仍有未报价 SKU 的询价单')

    const detail = await apiOk(request, `/api/supplier/inquiries/${target.inquiryId}/quotations`)
    expect(detail.inquiry, '报价只增不改：明细响应不再返回可改价标记').not.toHaveProperty('canEditExistingQuotes')
    const emptyItem = (detail.items || []).find((item) => (item.qualities || []).length === 0)
    expect(emptyItem, '待报价单需要返回未报价的 SKU 行，页面才有新增入口').toBeTruthy()

    await openPage(page, 'inquiries')
    const row = page.getByTestId('inquiry-row').filter({ hasText: target.inquiryNo })
    await row.getByTestId('inquiry-quote-action').click()

    const modal = page.getByTestId('quote-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal-head h3')).toHaveText(`去报价 · ${target.inquiryNo}`)
    await expect(modal.getByTestId('quote-submit')).toHaveText('保存并提交报价')
    // 历史报价行只读：弹窗里不存在改价 / 已改价入口
    await expect(modal.getByTestId('quote-row-history').first().locator('input')).toHaveCount(0)
    await expect(modal).not.toContainText('已改价')
    await expect(page.getByTestId('quote-modal-header')).toContainText(target.insuranceCompanyName)
    await expect(page.getByTestId('quote-table').locator('thead th')).toHaveText([
      '#', '配件名称', 'OE号', '数量', '品质档次', '金额-供应商', '操作',
    ])

    // 未报价 SKU 行必须有「新增报价（新品质）」入口
    const emptyRow = modal.getByTestId('quote-row-empty').first()
    await expect(emptyRow).toBeVisible()
    await emptyRow.getByTestId('quote-add-new-quality').click()

    const newRow = modal.getByTestId('quote-row-new').first()
    await expect(newRow).toBeVisible()
    const stamp = Date.now().toString().slice(-8)
    const supplier = `E2E自动化商家${stamp}`
    await newRow.getByTestId('quote-supplier-input').fill(supplier)
    await newRow.getByTestId('quote-price-input').fill('999.99')

    const submitRequest = page.waitForRequest(
      (req) => req.url().includes('/quotations:submit') && req.method() === 'POST',
    )
    const submitResponse = page.waitForResponse((res) => res.url().includes('/quotations:submit'))
    await modal.getByTestId('quote-submit').click()

    // 请求体只带本次新增行：新行无 quoteLineId / version，也不传 sourceType
    const captured = await submitRequest
    expect(captured.headers()['idempotency-key'], '提交必须带 Idempotency-Key').toBeTruthy()
    const body = captured.postDataJSON()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      supplierName: supplier,
      unitPrice: '999.99',
      inquiryItemId: emptyItem.inquiryItemId,
    })
    expect(body.items[0]).not.toHaveProperty('quoteLineId')
    expect(body.items[0]).not.toHaveProperty('version')
    expect(body.items[0]).not.toHaveProperty('sourceType')

    const payload = await (await submitResponse).json()
    expect(payload.code, `提交失败：${JSON.stringify(payload)}`).toBe(0)
    expect(payload.data.accepted).toHaveLength(1)
    expect(payload.data.accepted[0].quoteLineId).toBeTruthy()

    // 成功后关闭弹窗、提示，并用 summary 就地刷新列表行（新增 1 个 SKU 的报价）
    await expect(modal).toBeHidden()
    await expect(page.getByTestId('toast')).toContainText('报价已保存并提交')
    const summary = payload.data.summary
    expect(summary.quotedSkuCount, '从待报价变为部分报出').toBe(target.quotedSkuCount + 1)
    await expect(row.locator('td').nth(7)).toHaveText(String(summary.quotedSkuCount))
    await expect(row.getByTestId('quote-rate')).toHaveText(formatRate(summary.quoteRate))

    // 二次校验：真实报价明细里能查到本次提交的商家
    const after = await apiOk(request, `/api/supplier/inquiries/${target.inquiryId}/quotations`)
    const suppliers = after.items.flatMap((item) =>
      (item.qualities || []).flatMap((quality) => (quality.offers || []).map((offer) => offer.supplierName)),
    )
    expect(suppliers, '提交成功后明细接口应能查到本次新增报价').toContain(supplier)
  })

  test('同一品质下并列追加多家商家报价：新增报价（同品质）再次提交成功', async ({ page, request }) => {
    const list = await apiOk(request, '/api/supplier/inquiries?pageNum=1&pageSize=50')
    const candidates = list.list.filter((row) => (row.allowedActions || []).includes('APPEND_QUOTATION'))

    let target = null
    let detail = null
    for (const row of candidates) {
      const candidate = await apiOk(request, `/api/supplier/inquiries/${row.inquiryId}/quotations`)
      const hasGroup = (candidate.items || []).some((item) =>
        (item.qualities || []).some((quality) => (quality.offers || []).length > 0),
      )
      if (hasGroup) {
        target = row
        detail = candidate
        break
      }
    }
    test.skip(!target, '后端需要至少 1 条已有品质行的可追加询价单')

    await openPage(page, 'inquiries')
    await page
      .getByTestId('inquiry-row')
      .filter({ hasText: target.inquiryNo })
      .getByTestId('inquiry-quote-action')
      .click()

    const modal = page.getByTestId('quote-modal')
    await expect(modal).toBeVisible()
    // 已有品质行：同品质按钮必须出现在该品质的第一行
    await modal.getByTestId('quote-add-same-quality').first().click()

    const newRow = modal.getByTestId('quote-row-new').first()
    await expect(newRow).toBeVisible()
    const stamp = Date.now().toString().slice(-8)
    const supplier = `E2E并列商家${stamp}`
    await newRow.getByTestId('quote-supplier-input').fill(supplier)
    await newRow.getByTestId('quote-price-input').fill('1888.00')

    const submitResponse = page.waitForResponse((res) => res.url().includes('/quotations:submit'))
    await modal.getByTestId('quote-submit').click()
    const payload = await (await submitResponse).json()
    expect(payload.code, `提交失败：${JSON.stringify(payload)}`).toBe(0)
    expect(payload.data.accepted).toHaveLength(1)
    // 同品质追加不增加已报出的 SKU 数
    expect(payload.data.summary.quotedSkuCount).toBe(detail.summary.quotedSkuCount)
    await expect(modal).toBeHidden()

    const after = await apiOk(request, `/api/supplier/inquiries/${target.inquiryId}/quotations`)
    const group = after.items
      .flatMap((item) => item.qualities || [])
      .find((quality) => (quality.offers || []).some((offer) => offer.supplierName === supplier))
    expect(group, '同品质追加后应能在该品质下查到新商家').toBeTruthy()
    expect(group.offers.length, '同一品质下应并列多家商家报价').toBeGreaterThan(1)
  })

  test('报价只增不改：已下单 / 已过期的历史行只读，可在原品质后继续追加商家', async ({ page, request }) => {
    const list = await apiOk(request, '/api/supplier/inquiries?pageNum=1&pageSize=50')
    const target = list.list.find(
      (row) => (row.allowedActions || []).includes('APPEND_QUOTATION') && ['ORDERED', 'EXPIRED'].includes(row.status),
    )
    test.skip(!target, '后端需要至少 1 条已下单 / 已过期但仍可追加报价的询价单')

    const before = await apiOk(request, `/api/supplier/inquiries/${target.inquiryId}/quotations`)
    expect(before.inquiry.canAppendQuotes).toBe(true)
    expect(before.inquiry).not.toHaveProperty('canEditExistingQuotes')
    const historyOffers = before.items.flatMap((item) =>
      (item.qualities || []).flatMap((quality) => quality.offers || []),
    )
    const historyIds = historyOffers.map((offer) => offer.quoteLineId)
    expect(historyIds.length, '该询价单需要已有历史报价行').toBeGreaterThan(0)
    expect(before.items.flatMap((item) => item.qualities || []).flatMap((q) => q.offers || []).some((o) => 'editable' in o || 'version' in o)).toBe(false)

    await openPage(page, 'inquiries')
    const row = page.getByTestId('inquiry-row').filter({ hasText: target.inquiryNo })
    await expect(row.getByTestId('inquiry-quote-action')).toHaveText('报价明细')
    await row.getByTestId('inquiry-quote-action').click()

    const modal = page.getByTestId('quote-modal')
    await expect(modal.locator('.modal-head h3')).toHaveText(`报价明细 · ${target.inquiryNo}`)
    // 已下单 / 已过期：按钮文案退回「保存新增报价」，历史行没有输入框、没有已锁定提示
    await expect(modal.getByTestId('quote-submit')).toHaveText('保存新增报价')
    await expect(modal.getByTestId('quote-row-history').first().locator('input')).toHaveCount(0)
    await expect(modal.getByTestId('quote-row-history').first().getByTestId('quote-price-text')).toBeVisible()
    await expect(modal).not.toContainText('已改价')

    // 追加：同一品质再加一家商家，历史行 ID 保持不变
    await modal.getByTestId('quote-add-same-quality').first().click()
    const newRow = modal.getByTestId('quote-row-new').first()
    const stamp = Date.now().toString().slice(-8)
    const supplier = `E2E闭单追加${stamp}`
    await newRow.getByTestId('quote-supplier-input').fill(supplier)
    await newRow.getByTestId('quote-price-input').fill('1666.00')

    const submitRequest = page.waitForRequest(
      (req) => req.url().includes('/quotations:submit') && req.method() === 'POST',
    )
    const submitResponse = page.waitForResponse((res) => res.url().includes('/quotations:submit'))
    await modal.getByTestId('quote-submit').click()
    const body = (await submitRequest).postDataJSON()
    expect(body.items, '只提交本次新增的行').toHaveLength(1)
    expect(body.items[0]).not.toHaveProperty('quoteLineId')
    expect(body.items[0]).not.toHaveProperty('version')
    expect(body.items[0].supplierName).toBe(supplier)

    const payload = await (await submitResponse).json()
    expect(payload.code, `提交失败：${JSON.stringify(payload)}`).toBe(0)
    expect(payload.data.accepted).toHaveLength(1)
    expect(payload.data.accepted[0]).not.toHaveProperty('action')
    await expect(modal).toBeHidden()

    const after = await apiOk(request, `/api/supplier/inquiries/${target.inquiryId}/quotations`)
    const afterOffers = after.items.flatMap((item) =>
      (item.qualities || []).flatMap((quality) => quality.offers || []),
    )
    // 只增不改：历史报价行一条不少、内容一字不改（接口不再返回 editable/version 等可改价字段）
    for (const offer of historyOffers) {
      const current = afterOffers.find((item) => item.quoteLineId === offer.quoteLineId)
      expect(current, `历史报价行 ${offer.quoteLineId} 不应消失`).toBeTruthy()
      expect(current, '历史报价行只增不改：内容保持不变').toEqual(offer)
    }

    // 追加行是新 ID，并排在该品质已有报价之后（同一品质可连续追加多家商家）
    const newQuoteLineId = payload.data.accepted[0].quoteLineId
    expect(newQuoteLineId, '追加报价应返回新报价行 ID').toBeTruthy()
    expect(historyIds).not.toContain(newQuoteLineId)
    const appended = after.items
      .flatMap((item) => item.qualities || [])
      .find((quality) => (quality.offers || []).some((offer) => offer.quoteLineId === newQuoteLineId))
    expect(appended, '追加后应能在原品质下查到新商家').toBeTruthy()
    expect(appended.offers.map((offer) => offer.quoteLineId).pop()).toBe(newQuoteLineId)
    expect(appended.offers.some((offer) => offer.supplierName === supplier)).toBe(true)
  })

  test('导出：POST 当前筛选到 exports，按 Content-Disposition 下载 Excel', async ({ page, request }) => {
    const options = await apiOk(request, '/api/supplier/inquiries/status-options')
    const target = options.items[0]

    // 接口契约：二进制流 + Content-Disposition
    const binary = await request.fetch('/api/supplier/inquiries/exports', {
      method: 'POST',
      headers: { ...HQ, 'Content-Type': 'application/json', 'Idempotency-Key': newKey() },
      data: { status: [target.value], format: 'XLSX' },
    })
    expect(binary.status(), `导出接口期望 2xx，实际 ${binary.status()}`).toBe(200)
    expect(binary.headers()['content-type']).toContain('spreadsheetml')
    expect(binary.headers()['content-disposition']).toContain('.xlsx')
    expect((await binary.body()).length, '导出文件不能为空').toBeGreaterThan(0)

    // 页面：导出按钮带上当前筛选，浏览器收到下载
    await openPage(page, 'inquiries')
    await page.getByTestId('inquiry-status-filter').selectOption(target.value)
    await expect(page.getByTestId('inquiry-row')).toHaveCount(
      (await apiOk(request, `/api/supplier/inquiries?status[]=${encodeURIComponent(target.value)}&pageNum=1&pageSize=20`)).list.length,
    )

    const exportRequest = page.waitForRequest(
      (req) => req.url().includes('/supplier/inquiries/exports') && req.method() === 'POST',
    )
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('inquiry-export').click()
    const download = await downloadPromise

    const sent = await exportRequest
    expect(sent.postDataJSON()).toMatchObject({ status: [target.value], format: 'XLSX' })
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
    const filePath = await download.path()
    const { size } = await import('node:fs/promises').then((fs) => fs.stat(filePath))
    expect(size, '下载文件不能为空').toBeGreaterThan(0)
    await expect(page.getByTestId('toast')).toContainText('已导出')
  })

  test('身份切换：切到 channel-quoter 后请求头与列表范围随之刷新', async ({ page, request }) => {
    const channelData = await apiOk(request, '/api/supplier/inquiries?pageNum=1&pageSize=20', { headers: CHANNEL })

    await openPage(page, 'inquiries')
    const headers = []
    page.on('request', (req) => {
      if (req.url().includes('/api/supplier/inquiries') && !req.url().includes('status-options')) {
        headers.push(req.headers()['x-mock-user'])
      }
    })

    await page.getByTestId('mock-user-switch').selectOption('channel-quoter')
    await expect(page.getByTestId('toast')).toContainText('已切换身份')
    await expect(page.getByTestId('inquiry-row')).toHaveCount(channelData.list.length)
    expect(headers.at(-1), '切换身份后请求头应带 channel-quoter').toBe('channel-quoter')

    if (channelData.list.length > 0) {
      await expect(page.getByTestId('inquiry-row').first().locator('td').nth(0)).toHaveText(
        channelData.list[0].inquiryNo,
      )
    }
  })
})
