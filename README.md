# 赛鸽血统环号登记站

运行：

```bash
npm start
```

访问 `http://localhost:3024`。支持档案、血统查询、转让和归巢成绩记录，
并接收鸽会回传的离线成绩包，网络恢复后自动合并对账。

## 接口

- `GET /`：页面（档案、血统、转让、成绩、离线成绩包对账状态）
- `GET /api/pigeons`：鸽只档案列表
- `POST /api/pigeons`：创建档案
- `GET /api/pigeons/:ringNo/relation`：父母、子代、转让、血统查询
- `POST /api/pigeons/:ringNo/transfers|races|vaccines`：录入转让 / 成绩 / 疫苗
- `GET /api/packages`：离线成绩包列表及对账状态
- `POST /api/packages`：录入离线成绩包（同 id 或同内容指纹只入一次）
- `POST /api/packages/:id/retry`：冲突包重试对账
- `POST /api/pigeons/:ringNo/backfill`：回填父母环号（已登记不可覆盖）

## 成绩对账规则

- 同一鸽只同一场比赛只保留最早有效归巢时间；重复成绩包只入一次。
- 两位计时员分别提交：时间一致 → 对账通过；不一致 → 冲突，冲突包保留后可重试。
- 成绩状态分 `reconciled`（对账通过）、`pending`（待核验）、`conflict`（冲突），
  页面和接口均会展示。
- 转让提交后，按比赛日期确定鸽主：待核验的成绩仍归原鸽主，新成绩归新鸽主。
- 成绩包可携带 `fatherRing`/`motherRing` 回填父母环号；已有父母不被覆盖，不一致记入冲突。

## 结构

- `server.js`：服务入口与路由
- `src/store.js`：档案存取、种子数据、鸽主归属
- `src/reconcile.js`：成绩包接收、去重、交叉核验、冲突重试、环号回填
- `src/page.js`：页面
