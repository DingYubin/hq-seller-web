// 原型一致性用例：以《03-卖方后台-华汽原型-v09112220.html》为基准，
// 逐项核对已实现页面（采购询价 / 报价明细 / 角色管理）的结构、文案与交互入口是否与原型一致。
// 本文件只读不改：不新增、不修改、不删除任何业务数据。
import { expect, test } from '@playwright/test'
import { INQUIRY_COLUMNS, ROLE_COLUMNS, apiOk, openPage, requireBackend } from './support.js'

// 原型「询价报价明细」的品质档次顺序
const PROTOTYPE_QUALITY_TIERS = ['品牌件', '4S 原厂件', '流通原厂件', '国际品牌件', '其他']
const PROTOTYPE_QUALITY_TABLE_COLUMNS = ['#', '配件名称', 'OE号', '数量', '品质档次', '金额-供应商', '操作']
const PROTOTYPE_ROLE_USER_COLUMNS = ['使用组织', '用户姓名', '登录账号', '部门 · 岗位', '状态']

test.describe('原型 UI 一致性', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('采购询价清单：待报价角标 / 工具栏 / 13 列表头 / 操作文案与原型一致', async ({ page, request }) => {
    const data = await apiOk(request, '/api/supplier/inquiries?pageNum=1&pageSize=20')
    expect(data.list.length, '需要后端 seed 至少 1 条询价单').toBeGreaterThan(0)

    await openPage(page, 'inquiries')

    // 原型：卡片头「采购询价清单」+ 待报价角标
    await expect(page.locator('.page-head h1')).toContainText('采购询价')
    await expect(page.getByTestId('pending-badge')).toHaveText(/^待报价 \d+$/)

    // 原型工具栏：搜索 VIN / 保险公司 / 单号 + 全部状态 + 导出
    await expect(page.getByPlaceholder('搜索 VIN / 保险公司 / 单号')).toBeVisible()
    await expect(page.getByTestId('inquiry-status-filter')).toBeVisible()
    await expect(page.getByTestId('inquiry-status-filter').locator('option').first()).toHaveText('全部状态')
    await expect(page.getByTestId('inquiry-export')).toHaveText('导出')

    // 原型 13 列表头，顺序一致
    await expect(page.getByTestId('inquiry-table').locator('thead th')).toHaveText(INQUIRY_COLUMNS)

    // 原型行操作：未过期且未下单 =「去报价」（主按钮）；已下单 / 已过期 =「报价明细」（描边按钮）；否则「—」
    for (const row of data.list.slice(0, 5)) {
      const actions = row.allowedActions || []
      const canAppendQuote = actions.includes('APPEND_QUOTATION')
      const canOpen = actions.includes('VIEW_QUOTATIONS') || canAppendQuote
      const canQuoteNow = canAppendQuote && !['ORDERED', 'EXPIRED'].includes(row.status)
      const tr = page.getByTestId('inquiry-row').filter({ hasText: row.inquiryNo })
      if (!canOpen) {
        await expect(tr.locator('td').last()).toHaveText('—')
        continue
      }
      const button = tr.getByTestId('inquiry-quote-action')
      await expect(button).toHaveText(canQuoteNow ? '去报价' : '报价明细')
      await expect(button).toHaveClass(canQuoteNow ? /btn-primary/ : /btn-outline/)
    }
  })

  test('报价明细：客户车辆信息 / 品质档次 / 追加报价入口 / 无改价与原型一致', async ({ page, request }) => {
    const list = await apiOk(request, '/api/supplier/inquiries?pageNum=1&pageSize=50')
    // 原型：未过期且未下单才能进「去报价」；该单必须已有历史报价行，才能核对只读与追加
    let target = null
    for (const row of list.list.filter(
      (row) =>
        (row.allowedActions || []).includes('APPEND_QUOTATION') && !['ORDERED', 'EXPIRED'].includes(row.status),
    )) {
      const detail = await apiOk(request, `/api/supplier/inquiries/${row.inquiryId}/quotations`)
      expect(detail.inquiry, '报价只增不改：明细响应不再返回可改价标记').not.toHaveProperty('canEditExistingQuotes')
      if ((detail.items || []).some((item) => (item.qualities || []).length > 0)) {
        target = row
        break
      }
    }
    test.skip(!target, '后端需要至少 1 条已报价且仍可「去报价」的询价单')

    await openPage(page, 'inquiries')
    await page.getByTestId('inquiry-row').filter({ hasText: target.inquiryNo }).getByTestId('inquiry-quote-action').click()
    const modal = page.getByTestId('quote-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal-head h3')).toHaveText(`去报价 · ${target.inquiryNo}`)

    // 原型：客户与车辆信息（保险公司 / 定损人员 / 车型 / VIN / 归属渠道 / 有效期）
    const header = page.getByTestId('quote-modal-header')
    for (const label of ['保险公司', '定损人员', '车型', 'VIN', '归属渠道', '有效期 / 结束原因']) {
      await expect(header).toContainText(label)
    }

    // 原型：配件报价明细表头
    await expect(page.getByTestId('quote-table').locator('thead th')).toHaveText(PROTOTYPE_QUALITY_TABLE_COLUMNS)

    // 原型：每个 SKU 都可「新增报价（新品质）」；已有品质行可「新增报价（同品质）」
    await expect(modal.getByTestId('quote-add-new-quality').first()).toBeVisible()
    await expect(modal.getByTestId('quote-add-same-quality').first()).toBeVisible()

    // 报价只增不改：历史行只读（单价是文本、不是输入框），且没有任何「已改价 / 改品质」入口
    const historyRow = modal.getByTestId('quote-row-history').first()
    if ((await historyRow.count()) > 0) {
      await expect(historyRow.locator('input')).toHaveCount(0)
      await expect(historyRow.getByTestId('quote-price-text')).toBeVisible()
    }
    await expect(modal).not.toContainText('已改价')

    // 品质档次固定 5 档且顺序一致：仅「新增报价（新品质）」产生的行以品质下拉呈现
    await modal.getByTestId('quote-add-new-quality').first().click()
    await expect(modal.getByTestId('quote-quality-select').first().locator('option')).toHaveText(
      PROTOTYPE_QUALITY_TIERS,
    )
    await expect(modal.getByTestId('quote-row-new').first().getByTestId('quote-price-input')).toBeVisible()

    // 原型：底部只有「取消 / 保存并提交报价」，报价无草稿态
    await expect(modal.getByTestId('quote-submit')).toHaveText('保存并提交报价')
    await expect(modal.locator('.modal-foot')).toContainText('取消')
    await expect(modal).not.toContainText('草稿')

    await modal.getByRole('button', { name: '取消' }).click()
    await expect(modal).toBeHidden()
  })

  test('角色管理：筛选 / 8 列表头 / 行操作 / 已绑定用户弹窗与原型一致', async ({ page, request }) => {
    const list = await apiOk(request, '/api/roles?pageNum=1&pageSize=20')
    expect(list.list.length, '需要后端 seed 至少 1 个角色').toBeGreaterThan(0)

    await openPage(page, 'roles')
    await expect(page.locator('.page-head h1')).toContainText('角色管理')

    // 原型工具栏：主体类型 / 下发对象 / 状态 / 搜索角色名称·编码 / 新增角色
    await expect(page.getByTestId('role-subject-type-filter').locator('option')).toHaveText([
      '全部主体类型', '总部', '渠道', '客户',
    ])
    await expect(page.getByTestId('role-subject-filter').locator('option').first()).toHaveText('全部下发对象')
    await expect(page.getByTestId('role-status-filter').locator('option')).toHaveText(['全部状态', '启用', '停用'])
    await expect(page.getByPlaceholder('搜索角色名称 / 编码')).toBeVisible()
    await expect(page.getByTestId('role-create')).toContainText('新增角色')

    // 原型 8 列表头，顺序一致：角色 / 角色编码 / 下发对象 / 主体类型 / 资源权限 / 已绑定用户 / 状态 / 操作
    await expect(page.getByTestId('role-table').locator('thead th')).toHaveText(ROLE_COLUMNS)

    // 原型行操作：编辑 / 停用·启用 / 删除（删除受 allowedActions 控制）
    const first = list.list[0]
    const actions = first.allowedActions || []
    const firstRow = page.getByTestId('role-row').filter({ hasText: first.code })
    if (actions.includes('EDIT')) await expect(firstRow.getByTestId('role-edit')).toHaveText('编辑')
    if (actions.includes('TOGGLE_STATUS')) {
      await expect(firstRow.getByTestId('role-toggle')).toHaveText(first.status === 'ACTIVE' ? '停用' : '启用')
    }
    if (!actions.includes('DELETE')) {
      await expect(firstRow.getByTestId('role-delete')).toHaveCount(0)
    }

    // 原型「已绑定用户」弹窗：使用组织 / 用户姓名 / 登录账号 / 部门 · 岗位 / 状态
    const bound = list.list.find((row) => (row.allowedActions || []).includes('VIEW_USERS') && row.userCount > 0)
    test.skip(!bound, '需要至少 1 个已绑定用户且允许查看的角色')
    await page.getByTestId('role-row').filter({ hasText: bound.code }).getByTestId('role-users-link').click()
    const usersModal = page.getByTestId('role-users-modal')
    await expect(usersModal).toBeVisible()
    await expect(usersModal.locator('.modal-head h3')).toHaveText(`已绑定用户 · ${bound.name}`)
    await expect(usersModal.getByTestId('role-users-table').locator('thead th')).toHaveText(PROTOTYPE_ROLE_USER_COLUMNS)
    await usersModal.getByRole('button', { name: '关闭' }).click()
    await expect(usersModal).toBeHidden()
  })
})
