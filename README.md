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

> 采购询价按原型口径是**只增不改**：没有改价 / 覆盖已有报价行的入口，历史报价行在明细里只读展示；
> `quotations:submit` 只提交本次新增的行（同批不重复），同一「品质 + 商家」重复提交会被服务端拒绝（`40923`）。
> 已下单 / 已过期的询价单同样只允许追加新报价行。
| 角色管理（`#/roles`） | `GET /api/roles`、`GET /api/roles/{roleId}`、`GET /api/roles/assignment-targets`、`GET /api/roles/{roleId}/users`、`GET /api/permissions`、`POST /api/roles`、`PATCH /api/roles/{roleId}`、`DELETE /api/roles/{roleId}?version=N` |
| 订单清单 / 售后处理 / 组织管理 | 本期未实现，仅保留导航占位 |

联调身份在顶栏切换，写入 `localStorage` 并作为 `x-mock-user` 发送：`hq-admin`（默认）/ `channel-quoter`。

## 端到端测试

`npm run test:e2e` 在 `tests/e2e` 下运行 14 条用例，全部直连真实后端（不 mock）：

| 文件 | 条数 | 覆盖 |
| --- | --- | --- |
| `inquiry.spec.js` | 7 | 采购询价清单、状态筛选、报价明细、保存并提交报价（同品质 / 新品质追加）、报价只增不改（历史行只读 + 已下单 / 已过期仍可追加） |
| `role.spec.js` | 4 | 角色列表筛选、新增 / 编辑、启停用、删除、已绑定用户弹窗 |
| `prototype-parity.spec.js` | 3 | 只读用例（不写业务数据）：对照《03-卖方后台-华汽原型-v09112220.html》核对采购询价 / 报价明细 / 角色管理的表头顺序、固定文案与交互入口 |

运行前先确保 `hq-seller-service` 监听 3001 且已 seed 询价单、角色、权限与受限角色数据。
干净数据推荐在卖方服务仓库执行 `npm run flow:test:fresh`（自带全新内存 Mongo），
或先 `npm run dev:mongo` 再以 `SEED_BASELINE=true` 启动服务；`inquiry.spec.js` 会写入报价，跑完后如需复用数据请重建 seed。
