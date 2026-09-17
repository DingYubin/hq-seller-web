# hq-seller-web · 卖方后台 Web

React + Vite 实现的卖方后台前端，唯一接口依据为
`hq_spc/docs/frontend-api-html/seller-inquiry.html` 与 `seller-role.html`。
页面字段顺序 = 接口字段顺序，所有写操作带 `Idempotency-Key`，请求头统一携带 `x-mock-user`。

## 命令

```bash
npm install
npm run dev        # http://localhost:5173 （/api 代理到 http://localhost:3001）
npm run build
npm run test:e2e   # Playwright，需 hq-seller-service 已在 3001 端口启动
```

代理目标可用 `VITE_PROXY_TARGET` 覆盖；接口前缀就是 `/api`，不要加版本段。

## 页面与接口

| 页面 | 接口 |
| --- | --- |
| 采购询价（默认页 `#/inquiries`） | `GET /api/supplier/inquiries`、`GET /api/supplier/inquiries/status-options`、`GET /api/supplier/inquiries/{inquiryId}/quotations`、`POST /api/supplier/inquiries/{inquiryId}/quotations:submit`、`POST /api/supplier/inquiries/exports` |
| 角色管理（`#/roles`） | `GET /api/roles`、`GET /api/roles/{roleId}`、`GET /api/roles/assignment-targets`、`GET /api/roles/{roleId}/users`、`GET /api/permissions`、`POST /api/roles`、`PATCH /api/roles/{roleId}`、`DELETE /api/roles/{roleId}?version=N` |
| 订单清单 / 售后处理 / 组织管理 | 本期未实现，仅保留导航占位 |

联调身份在顶栏切换，写入 `localStorage` 并作为 `x-mock-user` 发送：`hq-admin`（默认）/ `channel-quoter`。

## 端到端测试

`tests/e2e` 下 9 条用例全部直连真实后端（不 mock）。运行前先确保
`hq-seller-service` 监听 3001 且已 seed 询价单、角色、权限与受限角色数据。
