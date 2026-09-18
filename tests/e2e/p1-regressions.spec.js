// 采购询价 / 角色管理 P1 回归用例：通过真实卖方服务验证权限边界、双条件筛选与版本冲突恢复。
import { expect, test } from '@playwright/test'
import { HQ, apiOk, newKey, openPage, requireBackend } from './support.js'

const uniqueStamp = () => Date.now().toString(36).toUpperCase()

async function createTemporaryRole(request) {
  const stamp = uniqueStamp()
  const response = await request.fetch('/api/roles', {
    method: 'POST',
    headers: { ...HQ, 'Content-Type': 'application/json', 'Idempotency-Key': newKey() },
    data: {
      name: `E2E版本冲突角色${stamp}`,
      code: `E2E_CONFLICT_${stamp}`,
      subjectType: 'HQ',
      scopeMode: 'ALL',
      subjectIds: [],
      permissionIds: [],
      remark: 'P1 回归用例结束后删除',
    },
  })
  const payload = await response.json()
  expect(response.status(), `临时角色创建失败：${JSON.stringify(payload)}`).toBe(200)
  expect(payload.code).toBe(0)
  return payload.data
}

async function deleteTemporaryRole(request, role) {
  const response = await request.fetch(`/api/roles/${role.roleId}?version=${role.version}`, {
    method: 'DELETE',
    headers: { ...HQ, 'Idempotency-Key': newKey() },
  })
  expect(response.status(), `临时角色清理失败：${role.roleId}`).toBe(200)
}

test.describe('P1 回归验证', () => {
  test.beforeAll(async ({ request }) => {
    await requireBackend(request)
  })

  test('无角色管理权限的账号不显示菜单，直接访问角色路由回到采购询价', async ({ page }) => {
    await openPage(page, 'inquiries')
    await page.getByTestId('mock-user-switch').selectOption('mock-seller-customer')
    await expect(page.getByTestId('nav-roles')).toHaveCount(0)

    await page.goto('/#/roles')
    await expect(page).toHaveURL(/#\/inquiries$/)
    await expect(page.getByTestId('nav-roles')).toHaveCount(0)
    await expect(page.getByTestId('role-table')).toHaveCount(0)
    await expect(page.getByTestId('role-create')).toHaveCount(0)
  })

  test('已绑定用户弹窗的组织与用户筛选可以同时生效', async ({ page, request }) => {
    const roles = await apiOk(request, '/api/roles?keyword=CHANNEL_QUOTER&pageNum=1&pageSize=20')
    const role = roles.list.find((item) => item.code === 'CHANNEL_QUOTER' && item.userCount > 0)
    test.skip(!role, '后端需要 seed 一个已绑定用户的 CHANNEL_QUOTER 角色')

    await openPage(page, 'roles')
    await page.getByTestId('role-search').fill(role.code)
    const row = page.getByTestId('role-row').filter({ hasText: role.code })
    await expect(row).toHaveCount(1)
    await row.getByTestId('role-users-link').click()

    const modal = page.getByTestId('role-users-modal')
    await expect(modal).toBeVisible()
    const roleUsersPath = `/api/roles/${role.roleId}/users`
    const finalRequest = page.waitForRequest((requestEvent) => {
      if (requestEvent.method() !== 'GET' || !requestEvent.url().includes(roleUsersPath)) return false
      const url = new URL(requestEvent.url())
      return url.searchParams.get('organizationKeyword') === '深圳' && url.searchParams.get('userKeyword') === '王'
    })

    // 两个输入框在同一个防抖窗口内变化；最终请求必须保留两个条件，不能互相取消。
    await modal.getByTestId('role-users-org-filter').fill('深圳')
    await modal.getByTestId('role-users-user-filter').fill('王')
    const requestWithBothFilters = await finalRequest
    const url = new URL(requestWithBothFilters.url())
    expect(url.searchParams.get('organizationKeyword')).toBe('深圳')
    expect(url.searchParams.get('userKeyword')).toBe('王')
  })

  test('角色编辑遇到版本冲突会刷新版本但保留当前输入，第二次保存成功', async ({ page, request }) => {
    const created = await createTemporaryRole(request)
    let current = created
    const editedName = `${created.name}·当前输入`

    try {
      await openPage(page, 'roles')
      await page.getByTestId('role-search').fill(created.code)
      const row = page.getByTestId('role-row').filter({ hasText: created.code })
      await expect(row).toHaveCount(1)
      await row.getByTestId('role-edit').click()

      const modal = page.getByTestId('role-form-modal')
      await expect(modal).toBeVisible()
      await expect(modal.getByTestId('role-name')).toHaveValue(created.name)
      await modal.getByTestId('role-name').fill(editedName)

      const externalUpdate = await request.fetch(`/api/roles/${created.roleId}`, {
        method: 'PATCH',
        headers: { ...HQ, 'Content-Type': 'application/json', 'Idempotency-Key': newKey() },
        data: { name: `${created.name}·外部更新`, version: created.version },
      })
      const externalPayload = await externalUpdate.json()
      expect(externalUpdate.status()).toBe(200)
      expect(externalPayload.code).toBe(0)
      current = externalPayload.data

      await modal.getByTestId('role-save').click()
      await expect(modal).toContainText('角色已被其他人更新，已刷新最新版本和权限；当前输入已保留，请再次保存')
      await expect(modal.getByTestId('role-name')).toHaveValue(editedName)
      await expect(modal.locator('.form-meta')).toContainText(`当前版本：${current.version}`)

      await modal.getByTestId('role-save').click()
      await expect(modal).toBeHidden()
      await expect(row.locator('td').nth(0)).toHaveText(editedName)
    } finally {
      // 第二次保存成功后的版本从列表行重新读取，避免依赖 UI 请求返回时序。
      const latest = await apiOk(request, `/api/roles?keyword=${encodeURIComponent(created.code)}&pageNum=1&pageSize=20`)
      const row = latest.list.find((item) => item.roleId === created.roleId)
      if (row) current = row
      await deleteTemporaryRole(request, current)
    }
  })
})
