// 角色管理页端到端用例：全部断言基于真实接口返回
import { expect, test } from '@playwright/test'
import {
  HQ,
  ROLE_COLUMNS,
  ROLE_STATUS_LABEL,
  SUBJECT_TYPE_LABEL,
  apiFail,
  apiOk,
  expectTestIdOrder,
  newKey,
  openPage,
  requireBackend,
} from './support.js'

const stamp = () => Date.now().toString(36).toUpperCase()

async function firstSelectablePermission(request) {
  const data = await apiOk(request, '/api/permissions?includeInactive=true&pageNum=1&pageSize=200')
  const list = Array.isArray(data.list) ? data.list : []
  return list.find((item) => item.selectable !== false) || null
}

test.describe('角色管理', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('角色列表加载与筛选：8 列按契约顺序渲染，主体类型 / 搜索都由服务端过滤', async ({ page, request }) => {
    const list = await apiOk(request, '/api/roles?pageNum=1&pageSize=20')
    expect(list.list.length, '需要后端 seed 至少 1 个角色').toBeGreaterThan(0)

    await openPage(page, 'roles')
    await expect(page.getByTestId('role-table').locator('thead th')).toHaveText(ROLE_COLUMNS)
    await expect(page.getByTestId('role-row')).toHaveCount(list.list.length)

    const first = list.list[0]
    const cells = page.getByTestId('role-row').first().locator('td')
    await expect(cells.nth(0)).toHaveText(first.name)
    await expect(cells.nth(1)).toHaveText(first.code)
    await expect(cells.nth(2)).toContainText(first.scopeLabel)
    await expect(cells.nth(3)).toHaveText(SUBJECT_TYPE_LABEL[first.subjectType])
    await expect(cells.nth(5)).toContainText(`${first.userCount} 人`)
    await expect(page.getByTestId('role-status').first()).toHaveText(ROLE_STATUS_LABEL[first.status])
    if ((first.permissions || []).length > 0) {
      await expect(page.getByTestId('role-permissions').first()).toContainText(first.permissions[0].name)
    }

    // 主体类型筛选：CHANNEL → 列表内容必须与不带前端二次过滤的接口结果一致
    const channel = await apiOk(request, '/api/roles?subjectType=CHANNEL&pageNum=1&pageSize=20')
    await page.getByTestId('role-subject-type-filter').selectOption('CHANNEL')
    await expect(page.getByTestId('role-row')).toHaveCount(channel.list.length)
    const subjectTexts = await page.getByTestId('role-row').locator('td:nth-child(4)').allInnerTexts()
    expect(subjectTexts.every((text) => text.trim() === '渠道'), `主体类型筛选结果应全部为渠道：${subjectTexts.join(',')}`).toBe(true)

    // 搜索框（防抖 300ms）：关键字结果同样对齐接口
    const keyword = channel.list[0] ? channel.list[0].code.slice(0, 6) : 'CHANNEL'
    const searched = await apiOk(
      request,
      `/api/roles?subjectType=CHANNEL&keyword=${encodeURIComponent(keyword)}&pageNum=1&pageSize=20`,
    )
    await page.getByTestId('role-search').fill(keyword)
    await expect(page.getByTestId('role-row')).toHaveCount(searched.list.length)
    if (searched.list.length > 0) {
      await expect(page.getByTestId('role-row').first().locator('td').nth(1)).toContainText(keyword)
    }
  })

  test('新增角色：编码输入即转大写，保存成功后出现在列表（随后清理）', async ({ page, request }) => {
    const permission = await firstSelectablePermission(request)
    const code = `E2E_ROLE_${stamp()}`
    const name = `E2E自动化角色${stamp()}`
    let created = null

    try {
      await openPage(page, 'roles')
      await page.getByTestId('role-create').click()
      const modal = page.getByTestId('role-form-modal')
      await expect(modal).toBeVisible()
      await expectTestIdOrder(modal, [
        'role-name',
        'role-code',
        'role-subject-type',
        'role-scope',
        'role-status',
        'role-permission-options',
        'role-remark',
      ])

      await modal.getByTestId('role-name').fill(name)
      await modal.getByTestId('role-code').fill(code.toLowerCase())
      await expect(modal.getByTestId('role-code')).toHaveValue(code)
      await modal.getByTestId('role-subject-type').selectOption('HQ')
      if (permission) await modal.getByTestId(`role-permission-${permission.permissionId}`).check()
      await modal.getByTestId('role-remark').fill('E2E 自动化创建，用例结束会删除')

      const createRequest = page.waitForRequest((req) => req.url().endsWith('/api/roles') && req.method() === 'POST')
      const createResponse = page.waitForResponse((res) => res.url().endsWith('/api/roles') && res.request().method() === 'POST')
      await modal.getByTestId('role-save').click()

      const sent = await createRequest
      expect(sent.headers()['idempotency-key'], '创建角色应带 Idempotency-Key').toBeTruthy()
      expect(sent.postDataJSON()).toMatchObject({
        name,
        code,
        subjectType: 'HQ',
        scopeMode: 'ALL',
        status: 'ACTIVE',
      })

      const payload = await (await createResponse).json()
      expect(payload.code, `创建角色失败：${JSON.stringify(payload)}`).toBe(0)
      created = payload.data
      expect(created.roleId).toBeTruthy()

      await expect(modal).toBeHidden()
      await expect(page.getByTestId('toast')).toContainText('角色创建成功')

      // 列表中能查到（服务端关键字查询）
      const searched = await apiOk(request, `/api/roles?keyword=${encodeURIComponent(code)}&pageNum=1&pageSize=20`)
      expect(searched.list.map((row) => row.roleId)).toContain(created.roleId)

      await page.getByTestId('role-search').fill(code)
      const row = page.getByTestId('role-row').filter({ hasText: code })
      await expect(row).toHaveCount(1)
      await expect(row.locator('td').nth(0)).toHaveText(created.name)
      await expect(row.getByTestId('role-status')).toHaveText(ROLE_STATUS_LABEL[created.status])
    } finally {
      if (created) {
        const cleanup = await request.fetch(`/api/roles/${created.roleId}?version=${created.version}`, {
          method: 'DELETE',
          headers: { ...HQ, 'Idempotency-Key': newKey() },
        })
        expect(cleanup.status(), `用例清理失败：删除 ${code} 期望 HTTP 200`).toBe(200)
      }
    }
  })

  test('编辑与启停角色：表单 PATCH 全量语义，启停只传 status + version', async ({ page, request }) => {
    const permission = await firstSelectablePermission(request)
    const code = `E2E_EDIT_${stamp()}`
    const created = await apiOk(request, '/api/roles', {
      method: 'POST',
      idempotencyKey: newKey(),
      data: {
        name: `E2E可编辑角色${stamp()}`,
        code,
        subjectType: 'HQ',
        scopeMode: 'ALL',
        subjectIds: [],
        status: 'ACTIVE',
        permissionIds: permission ? [permission.permissionId] : [],
        remark: 'E2E 自动化创建',
      },
    })

    let current = created
    try {
      await openPage(page, 'roles')
      await page.getByTestId('role-search').fill(code)
      const row = page.getByTestId('role-row').filter({ hasText: code })
      await expect(row).toHaveCount(1)

      // 编辑：编码 / 主体类型 / 状态只读
      await row.getByTestId('role-edit').click()
      const modal = page.getByTestId('role-form-modal')
      await expect(modal).toBeVisible()
      await expect(modal.getByTestId('role-code')).toHaveAttribute('readonly', '')
      await expect(modal.getByTestId('role-code')).toHaveValue(code)
      await expect(modal.getByTestId('role-subject-type')).toBeDisabled()
      await expect(modal.getByTestId('role-status')).toBeDisabled()

      const newName = `${created.name}改`
      await modal.getByTestId('role-name').fill(newName)
      const patchRequest = page.waitForRequest((req) => req.method() === 'PATCH')
      const patchResponse = page.waitForResponse((res) => res.request().method() === 'PATCH')
      await modal.getByTestId('role-save').click()

      const sent = await patchRequest
      expect(sent.url()).toContain(`/api/roles/${created.roleId}`)
      const patchBody = sent.postDataJSON()
      expect(patchBody).toMatchObject({ name: newName, version: created.version })
      expect(patchBody, '编辑请求体不应混入启停之外的只读字段').not.toHaveProperty('status')

      const patchPayload = await (await patchResponse).json()
      expect(patchPayload.code, `编辑失败：${JSON.stringify(patchPayload)}`).toBe(0)
      current = patchPayload.data
      await expect(modal).toBeHidden()
      await expect(row.locator('td').nth(0)).toHaveText(newName)

      // 停用：只传 status + version
      await row.getByTestId('role-toggle').click()
      const confirm = page.getByTestId('confirm-dialog')
      await expect(confirm).toBeVisible()
      await expect(confirm).toContainText('停用')
      const toggleRequest = page.waitForRequest((req) => req.method() === 'PATCH')
      const toggleResponse = page.waitForResponse((res) => res.request().method() === 'PATCH')
      await confirm.getByTestId('confirm-ok').click()
      const toggleSent = await toggleRequest
      expect(toggleSent.postDataJSON()).toEqual({ status: 'INACTIVE', version: current.version })
      const togglePayload = await (await toggleResponse).json()
      expect(togglePayload.code, `停用失败：${JSON.stringify(togglePayload)}`).toBe(0)
      current = togglePayload.data
      await expect(row.getByTestId('role-status')).toHaveText('停用')
      await expect(row.getByTestId('role-toggle')).toHaveText('启用')

      // 再次启用
      await row.getByTestId('role-toggle').click()
      const enableRequest = page.waitForRequest((req) => req.method() === 'PATCH')
      const enableResponse = page.waitForResponse((res) => res.request().method() === 'PATCH')
      await page.getByTestId('confirm-dialog').getByTestId('confirm-ok').click()
      expect((await enableRequest).postDataJSON()).toEqual({ status: 'ACTIVE', version: current.version })
      const enablePayload = await (await enableResponse).json()
      expect(enablePayload.code, `启用失败：${JSON.stringify(enablePayload)}`).toBe(0)
      current = enablePayload.data
      await expect(row.getByTestId('role-status')).toHaveText('启用')
    } finally {
      const cleanup = await request.fetch(`/api/roles/${created.roleId}?version=${current.version}`, {
        method: 'DELETE',
        headers: { ...HQ, 'Idempotency-Key': newKey() },
      })
      expect(cleanup.status(), `用例清理失败：删除 ${code} 期望 HTTP 200`).toBe(200)
    }
  })

  test('删除受限角色：真实接口返回 40915，前端按 allowedActions 隐藏删除入口', async ({ page, request }) => {
    const list = await apiOk(request, '/api/roles?pageNum=1&pageSize=50')
    const restricted = list.list.find(
      (row) => row.userCount > 0 || !(row.allowedActions || []).includes('DELETE'),
    )
    test.skip(!restricted, '后端需要至少 1 个受限角色（已绑定用户或系统角色）才能验证 40915')

    const failure = await apiFail(request, `/api/roles/${restricted.roleId}?version=${restricted.version}`, 40915, {
      method: 'DELETE',
      idempotencyKey: newKey(),
    })
    expect(failure.message, '40915 必须给出可读原因').toBeTruthy()

    await openPage(page, 'roles')
    await page.getByTestId('role-search').fill(restricted.code)
    const row = page.getByTestId('role-row').filter({ hasText: restricted.code })
    await expect(row).toHaveCount(1)
    await expect(row.getByTestId('role-delete')).toHaveCount(0)
    await expect(row.locator('td').nth(5)).toContainText(`${restricted.userCount} 人`)
  })
})
