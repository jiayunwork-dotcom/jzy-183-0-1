# 测斜监测管理系统

把测斜孔的「导出文本 → 宏表 → 截图发群」流程，换成可追溯的网页系统：
探头标定版本化、基准切换可拼接、速率报警自动重算、每次判级留痕。

技术栈：Node.js 20 + TypeScript + Fastify + PostgreSQL 16（后端），
Vue 3 + Vite + ECharts（前端），Docker Compose 编排，前端打包后由应用服务托管。
计算全部在后端，前端只做录入与展示。

## 快速开始

```bash
docker compose up --build
# 打开 http://localhost:3000
```

首次使用顺序：

1. **探头/标定** 页：登记探头（如 `P1`），新增一条标定（系数、生效时间）；
2. **测孔** 页：录入编号、孔深、测点间距、正方向朝向、校核和容差、蓝/黄/红速率阈值；
3. 进入测孔：按 `深度, 正测, 反测[, 探头A, 探头B]` 逐行粘贴文本上传。
   第一测自动成为初始测量；换探头/修复/重设时勾选「本次为新基准首测」；
4. 看**预警总览**、**剖面叠加**、**深度时程**，点单次测量看**校核和、可疑点、
   更正、当时/现在判级**。

本地开发（不用 Docker）：

```bash
# 后端（需要一个 PG，默认 postgres://inclin:inclin@localhost:5432/inclin）
cd backend && npm install && DATABASE_URL=... npm run migrate && npm run dev
# 前端（vite 已把 /api 代理到 3000）
cd frontend && npm install && npm run dev
```

## 计算口径与基准决策

见 [`docs/ALGORITHM.md`](./docs/ALGORITHM.md)。一句话：换探头/修复产生新基准段时，
系统用换基准前后紧邻两次测量的逐深度差值取**中位数**估计探头系统零偏并扣除，
再把新段续接到旧段剖面上（而不是把旧段末测整条硬拷过来）；该选型的假设、
代价（整体性变形会被当零偏吸收等）与剖面图上的标注方式都写在该文档里。

## 模块划分

```
backend/src/
  models/types.ts          领域类型
  calc/
    math.ts                中位数、残差、天数、等级取大
    calibration.ts         按测量日期取生效标定系数
    baseline.ts            基准拼接：中位数系统偏移 δ
    profile.ts             单孔全量重算管线（唯一计算入口）
  validation/
    validate.ts            六类拒收规则（带具体字段）
    parseText.ts           逐行文本/表格粘贴解析
  db/
    schema.sql, migrate.ts PostgreSQL schema
    pool.ts                连接池 + 孔级事务咨询锁
    *.repo.ts              holes / probes / measurements / snapshots 仓储
  services/
    recompute.service.ts   全量重算 + 派生缓存替换 + 快照追加 + 当时/现在对比
    holes|probes|measurements|query.service.ts
  routes/                  Fastify 路由
  server.ts                入口（含静态托管前端与 SPA fallback）
frontend/src/views/        总览 / 测孔 / 孔详情 / 剖面 / 时程 / 测量 / 探头
```

## 拒收规则（400，响应 fields 给出具体字段）

1. 深度序列不等间距或与孔深不符（`depth` / `rows`）；
2. 同一深度出现两次（`depth`，带行号）；
3. 读数不是有限数（`a` / `b`，带行号）；
4. 测量日期早于该孔初始测量（`measuredAt`）；
5. 探头编号没有登记（`probeIdA` / `probeIdB`），或在测量日期尚无生效标定；
6. 阈值不是严格递增（`thresholds.yellow` / `thresholds.red`）。

## 更正与并发

- `PATCH /api/measurements/:id` 必须带 `expectedRevision`；并发同改只有一次生效，
  另一次返回 409，不覆盖；
- 更正、补录、标定改期、阈值修改后，该孔**全部**测量按当前数据重算，
  派生缓存整孔替换，判级快照只追加；
- `GET /api/measurements/:id/history` 返回首判（当时）与最新判（现在）及逐深度差异。

## 测试

```bash
cd backend && npm test
```

- 未设置 `DATABASE_URL` 时会自动尝试用 `embedded-postgres` 起一个临时 PostgreSQL；
  起不来则只跑纯算法测试，集成测试跳过。CI 可直接提供
  `DATABASE_URL=postgres://... npm test`。
- 覆盖：需求三测段算例、读数等于初测位移处处为 0、系数翻倍位移翻倍、
  正反测互换位移变号、增量结果与全量重算逐位一致、补录中间测量后速率按新顺序、
  并发更正只生效一次（另一次 409）、历史判级可查且差异并列、六类拒收。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/overview` | 全部测孔当前等级总览 |
| GET/POST | `/api/holes` | 测孔列表 / 录入 |
| PATCH | `/api/holes/:id` | 改属性/阈值（触发全孔重判） |
| GET | `/api/holes/:id/segments` | 基准段 |
| GET/POST | `/api/holes/:id/measurements` | 测量列表 / 上传（JSON rows 或 text 粘贴） |
| GET/PATCH | `/api/measurements/:id` | 单次详情（校核和+快照时间线）/ 更正（带 expectedRevision） |
| GET | `/api/measurements/:id/history` | 当时 vs 现在判级 |
| GET | `/api/holes/:id/profile?ids=1,2` | 任选几次测量剖面叠加（不带 ids 为全部） |
| GET | `/api/holes/:id/time-series?depth=0.5` | 某深度位移/速率时程 |
| GET/POST | `/api/probes` | 探头 |
| POST | `/api/calibrations` | 新增标定版本（级联重算受影响孔） |
