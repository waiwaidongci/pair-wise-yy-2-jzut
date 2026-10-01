# 赛鸽血统环号登记站

运行：

```bash
npm start
```

访问 `http://localhost:3024`。支持档案、血统查询、转让、归巢成绩记录，以及鸽会离线成绩包的接入与对账。

## 模块结构

原单文件已按职责拆开（启动命令与原有接口不变）：

- `server.js`：HTTP 启动入口
- `src/store.js`：档案存取、血统关系、父母环号回填
- `src/reconcile.js`：离线成绩包去重与对账
- `src/routes.js`：接口路由
- `src/page.js`：页面入口
- `src/httpUtils.js`：请求/响应工具

## 成绩对账规则

- 同一鸽只同一场比赛，两位计时员归巢时间相差不超过 5 分钟才**对账通过**；只有一位计时员提交时为**待核验**；时间差超限、鸽只未登记或时间无效为**冲突**。
- 对账通过的成绩只保留最早有效归巢时间，并写入正式成绩；冲突成绩不入正式账。
- 重复成绩包按 `packageId` 去重，只入一次且不覆盖原包；同一计时员对同场比赛的重复提交标记为 `duplicate_timer`，不充当第二位核验人。
- 成绩归属在提交入库时按当前鸽主固化：转让后，等待核验的成绩仍归原鸽主，转让之后的新成绩才归新鸽主。
- 冲突包保留在库中，可在页面或调用 `POST /api/score-packages/:packageId/retry` 重试（如鸽只补登记后）。
- 成绩包中的父母环号只回填旧档案的空环号，已登记的父母不会被覆盖。

## 接口

原有接口（路径、方法不变）：

- `GET /api/pigeons` / `POST /api/pigeons`
- `GET /api/pigeons/:ringNo/relation`
- `POST /api/pigeons/:ringNo/transfers|races|vaccines`

新增接口：

- `POST /api/score-packages`：接入离线成绩包，返回包与各鸽只比赛分组的对账状态（重复包返回 `duplicate: true`）
- `GET /api/score-packages` / `GET /api/score-packages/:packageId`：查询成绩包
- `POST /api/score-packages/:packageId/retry`：冲突包重试
- `POST /api/pigeons/:ringNo/parents`：父母环号回填（仅补空环号）

成绩包示例：

```json
{
  "packageId": "pkg-20260930-01",
  "items": [
    {
      "ringNo": "CHN-2026-001",
      "event": "300公里联赛",
      "date": "2026-09-30",
      "distance": 300,
      "rank": 6,
      "returnTime": "13:05:12",
      "timer": "计时员甲",
      "fatherRing": "CHN-2022-188",
      "motherRing": "CHN-2023-512"
    }
  ]
}
```
