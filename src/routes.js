// HTTP 路由：档案接口与离线成绩包接口（原有接口路径与行为保持不变）
import { readJsonBody, sendJson } from "./httpUtils.js";
import { backfillParents, findPigeon, loadDb, relation, saveDb } from "./store.js";
import { ingestPackage, pendingResultsFor, retryPackage, STATUS } from "./reconcile.js";
import { renderPage } from "./page.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const db = await loadDb();

  // 页面入口
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderPage());
  }

  // 档案列表（成绩带对账状态）
  if (req.method === "GET" && url.pathname === "/api/pigeons") {
    return sendJson(res, 200, db.pigeons);
  }

  // 创建鸽只档案
  if (req.method === "POST" && url.pathname === "/api/pigeons") {
    const input = await readJsonBody(req);
    if (db.pigeons.some(item => item.ringNo === input.ringNo)) {
      return sendJson(res, 409, { error: "ring_exists" });
    }
    const pigeon = {
      ringNo: input.ringNo,
      owner: input.owner,
      fatherRing: input.fatherRing || "",
      motherRing: input.motherRing || "",
      color: input.color,
      loft: input.loft,
      vaccines: [],
      transfers: [],
      races: []
    };
    db.pigeons.unshift(pigeon);
    await saveDb(db);
    return sendJson(res, 201, pigeon);
  }

  // 父母环号回填：只补空环号，已登记的父母不覆盖
  const parentsMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/parents$/);
  if (parentsMatch && req.method === "POST") {
    const pigeon = findPigeon(db, decodeURIComponent(parentsMatch[1]));
    if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
    const input = await readJsonBody(req);
    const before = { fatherRing: pigeon.fatherRing, motherRing: pigeon.motherRing };
    const changed = backfillParents(pigeon, input);
    if (changed) await saveDb(db);
    return sendJson(res, 200, { pigeon, before, after: { fatherRing: pigeon.fatherRing, motherRing: pigeon.motherRing }, changed });
  }

  // 血统查询（附成绩对账状态与待核验/冲突项）
  const relationMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/relation$/);
  if (relationMatch && req.method === "GET") {
    const ringNo = decodeURIComponent(relationMatch[1]);
    const data = relation(db, ringNo);
    if (!data) return sendJson(res, 404, { error: "pigeon_not_found" });
    return sendJson(res, 200, { ...data, pendingResults: pendingResultsFor(db, ringNo) });
  }

  // 转让 / 成绩 / 疫苗（手工录入成绩默认对账通过）
  const actionMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
  if (actionMatch && req.method === "POST") {
    const pigeon = findPigeon(db, decodeURIComponent(actionMatch[1]));
    if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
    const input = await readJsonBody(req);
    if (actionMatch[2] === "transfers") {
      const transfer = { date: input.date || today(), from: pigeon.owner, to: input.to };
      pigeon.owner = input.to;
      pigeon.transfers.push(transfer);
    }
    if (actionMatch[2] === "races") {
      pigeon.races.push({
        date: input.date || today(),
        event: input.event,
        distance: Number(input.distance || 0),
        returnTime: input.returnTime || "",
        rank: Number(input.rank || 0),
        status: STATUS.RECONCILED,
        ownerAtResult: pigeon.owner
      });
    }
    if (actionMatch[2] === "vaccines") pigeon.vaccines.push({ date: input.date || today(), name: input.name });
    await saveDb(db);
    return sendJson(res, 200, pigeon);
  }

  // 离线成绩包：接入
  if (req.method === "POST" && url.pathname === "/api/score-packages") {
    const input = await readJsonBody(req);
    try {
      const result = ingestPackage(db, input);
      await saveDb(db);
      return sendJson(res, result.duplicate ? 200 : 202, {
        duplicate: result.duplicate,
        package: result.package,
        groups: result.groups
      });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
  }

  // 离线成绩包：列表（含每个包的对账状态）
  if (req.method === "GET" && url.pathname === "/api/score-packages") {
    return sendJson(res, 200, db.scorePackages);
  }

  const packageMatch = url.pathname.match(/^\/api\/score-packages\/([^/]+)$/);
  if (packageMatch && req.method === "GET") {
    const pkg = db.scorePackages.find(item => item.packageId === decodeURIComponent(packageMatch[1]));
    return pkg ? sendJson(res, 200, pkg) : sendJson(res, 404, { error: "package_not_found" });
  }

  // 冲突包重试
  const retryMatch = url.pathname.match(/^\/api\/score-packages\/([^/]+)\/retry$/);
  if (retryMatch && req.method === "POST") {
    const result = retryPackage(db, decodeURIComponent(retryMatch[1]));
    if (!result) return sendJson(res, 404, { error: "package_not_found" });
    await saveDb(db);
    return sendJson(res, 200, { package: result.package, groups: result.groups });
  }

  return null;
}
