# AI 员工出售、收入账本与钱包资金契约

## 1. 文档职责

本文固化 AI 员工招聘后的商业事实、收入事实和钱包资金边界。它描述必须长期保持的产品不变量，并区分工作区验证与生产发布状态。

## 2. 核心结论

AI 员工被其他用户成功招聘后，无论价格是免费还是付费，都必须产生一条不可变的出售记录。

出售记录与收入账本不是同一个概念：

- **出售记录**回答“哪个开发者的哪个 Agent 版本，被谁、在什么公司和岗位招聘了”。
- **收入账本**回答“该次出售给平台和开发者分别带来多少收入”。
- **钱包账本**回答“招聘方的钱包余额如何变化”。
- **Employment**回答“招聘完成后形成了什么雇佣关系”。

免费招聘同样是一次有效出售，只是成交总额、平台收入和开发者收入均为 `0` 分。不能因为金额为零而省略出售记录或收入明细。

## 3. 当前实现事实

### 3.1 统一出售事实（工作区已验证，待生产发布）

迁移 `20260818_ai_direct_agent_sales` 新增 `ai_direct_agent_sales`，免费和付费招聘统一进入 `Sale → Offer → Employment`：

- 免费招聘不创建伪 `PaymentOrder`，不扣钱包，也不写 0 元钱包流水；
- 免费成交写一条 Sale，并写平台、开发者两条金额均为 `0` 的收入分录；
- 付费成交仍在同一 MySQL 事务中完成钱包扣款、Sale、Offer、Employment、平台 20% 和开发者 80% 收入分录；
- 收入分录统一通过非空 `saleId` 关联 Sale，免费分录允许 `paymentOrderId` 为空；
- 同一 `hiringIntentId`、Offer、Employment 或 PaymentOrder 均不能重复生成 Sale；
- 现有 `/paid-hiring/orders` 保留兼容，统一销售查询由 `agentSales` 服务提供。

工作区已在全新隔离 MySQL 从零应用全部 21 段迁移，并通过 `server/test/walletSalesMysql.test.ts` 的 4 个状态机测试；这不等同于生产迁移和生产招聘验收已完成。

### 3.2 退款与开发者可提现净收益

退款不修改或删除原 Sale 和原始 credit 分录，而是对同一 `saleId` 写平台、开发者 debit 补偿分录。可提现查询必须按 Sale 聚合开发者 `credit - debit` 净收益：

- 部分退款后只允许提现剩余正数净收益；
- 全额退款后该 Sale 不得进入可提现集合；
- 免费成交的 0 元分录不得进入可提现集合；
- 已进入结算流程的收入不允许再退款；
- 提现终态不可重复完成。

### 3.3 已实现的钱包充值与入口

当前生产钱包使用独立支付宝充值订单和 notify 路由，不复用历史付费雇佣支付宝订单：

- 用户从 `/wallet` 创建充值订单，最低 1.00 元；
- 支付宝异步通知验签成功或主动查单确认成功后，充值订单、钱包余额和唯一充值账本在同一事务内更新；
- `providerTradeNo`、充值账本关联和账本 `entryKey` 均受唯一约束，重复通知或重复查单不得再次增加余额；
- 支付返回页只触发主动查单，不以前端 URL 参数声明支付成功；
- 空请求体不得附加 `Content-Type: application/json`，否则 Fastify 会在进入主动查单处理器前拒绝请求。

钱包与组织管理属于已认证用户的核心工作区能力。`/wallet` 和 `/ai-work-admin/organizations` 必须同时出现在普通账户菜单及 workspace“工作台”菜单，不能只依赖用户记忆或手输路由。

## 4. 已实现的数据模型

迁移 `20260818_ai_direct_agent_sales` 新增独立 Sale 事实，不把免费出售伪装成支付：

- `id`
- `saleNo`
- `employmentId`，唯一
- `offerId`，唯一
- `paymentOrderId`，免费时可为空
- `organizationId/companyId/projectId/roleId/positionId`
- `buyerUserId`
- `developerUserId`
- `agentId/agentVersionId`
- `priceId/priceVersion`
- `pricingMode`：`free | paid`
- `currency`：首期固定 `CNY`
- `grossAmountFen`
- `platformRevenueFen`
- `developerRevenueFen`
- `status`：首期成功事实固定为 `completed`，退款通过补偿记录表达
- `completedAt/createdAt`

唯一约束必须保证同一 Employment 只产生一条出售记录。业务重放只能返回已有记录，不能重复累计销量。

## 5. 收入账本不变量

每条完成的出售记录必须对应收入明细：

- 一条 `platform_revenue` credit；
- 一条 `developer_payable` credit；
- 两条分录都通过 `saleId` 关联出售事实；
- 付费出售满足：`grossAmountFen = platformRevenueFen + developerRevenueFen`；
- 免费出售三者均为 `0`，但分录仍必须存在；
- `entryKey` 必须唯一，重复履约不得新增分录；
- 原始收入分录不可修改或删除，退款写 debit 补偿分录。

0 元收入分录不进入可提现金额，也不能创建 0 元提现申请，但必须进入开发者销售明细和经营统计。

## 6. 钱包边界

- 充值余额只可消费，不可提现；
- 开发者收入独立于充值余额，只有正数且处于 `posted` 的 `developer_payable` 分录可以申请提现；
- 免费招聘不执行钱包扣款，也不生成 0 元钱包流水；免费成交由出售表和收入账本记录；
- 付费招聘的钱包扣款、出售记录、收入分录、Offer 和 Employment 必须在同一事务提交；
- 任一步骤失败，整个招聘闭环回滚。

## 7. 查询与界面要求

开发者中心必须提供统一销售明细，免费和付费记录使用同一列表：

- Agent 名称和版本；
- 招聘方及公司/岗位；
- 免费或付费；
- 成交总额、平台分成、开发者收入；
- Employment/出售业务单号；
- 成交时间和退款状态。

财务管理页应能从出售记录进入 PaymentOrder、收入分录、钱包消费分录和退款记录。免费出售没有 PaymentOrder 和钱包消费，但必须能查看两条 0 元收入分录。

## 8. 验证与发布状态

### 8.1 已通过的工作区门禁

2026-08-18 使用专用测试管理配置创建随机空库，从零应用全部 21 段迁移后运行 `server/test/walletSalesMysql.test.ts`，结果为 `4 pass / 0 fail`，并自动删除隔离库。覆盖：

- 免费招聘幂等，只写一条 Sale、一个 Offer、一个 Employment 和两条 0 元收入分录；
- 免费招聘不创建 PaymentOrder，不写钱包流水，0 元收入不可提现；
- 付费招聘的钱包扣款、Sale、Offer、Employment 和 20%/80% 分录原子提交；
- 钱包余额不足时上述业务事实、钱包流水和 Position 编制全部回滚；
- 充值履约重放只入账一次；
- 部分退款后只暴露净开发者收益，全额退款后不再可提现；
- 提现完成终态拒绝重复完成。

同轮通过 API TypeScript 构建、定向 `oxlint`、格式和差异空白检查。邮件品牌测试独立记录在进度与交接文档中。

### 8.2 尚未完成

- 生产数据库备份及 `20260818_ai_direct_agent_sales` 迁移；
- API 与前端增量 release 切换；
- 生产免费成交、付费成交和统一销售查询验收；
- 生产退款/提现仅做只读核对，不为验收制造不必要真实资金操作。

完成生产迁移与运行验收前，状态必须写为“工作区实现与隔离 MySQL 已验证，待生产发布验收”，不得写成已上线。
