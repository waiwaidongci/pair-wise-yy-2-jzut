import http from "node:http";
import { loadDb, saveDb, ownerAt } from "./src/store.js";
import { ingestPackage, retryPackage, backfillParents } from "./src/reconcile.js";
import { renderPage } from "./src/page.js";

const port = Number(process.env.PORT || 3024);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function relation(db, ringNo) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage());
    }
    if (req.method === "GET" && url.pathname === "/api/pigeons") return sendJson(res, 200, db.pigeons);
    if (req.method === "POST" && url.pathname === "/api/pigeons") {
      const input = await body(req);
      if (db.pigeons.some(item => item.ringNo === input.ringNo)) return sendJson(res, 409, { error: "ring_exists" });
      const pigeon = { ...input, vaccines: [], transfers: [], races: [] };
      db.pigeons.unshift(pigeon);
      await saveDb(db);
      return sendJson(res, 201, pigeon);
    }

    const relationMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (relationMatch && req.method === "GET") {
      const data = relation(db, decodeURIComponent(relationMatch[1]));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
    }

    if (req.method === "GET" && url.pathname === "/api/packages") return sendJson(res, 200, db.packages);
    if (req.method === "POST" && url.pathname === "/api/packages") {
      const input = await body(req);
      const result = ingestPackage(db, input);
      if (!result.duplicate) await saveDb(db);
      return sendJson(res, result.duplicate ? 200 : 201, result);
    }

    const retryMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/retry$/);
    if (retryMatch && req.method === "POST") {
      const pkg = db.packages.find(p => p.id === decodeURIComponent(retryMatch[1]));
      if (!pkg) return sendJson(res, 404, { error: "package_not_found" });
      retryPackage(db, pkg);
      await saveDb(db);
      return sendJson(res, 200, pkg);
    }

    const backfillMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/backfill$/);
    if (backfillMatch && req.method === "POST") {
      const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(backfillMatch[1]));
      if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
      const input = await body(req);
      const bf = backfillParents(pigeon, input.fatherRing, input.motherRing);
      await saveDb(db);
      return sendJson(res, 200, { pigeon, changed: bf.changed, conflicts: bf.conflicts });
    }

    const actionMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (actionMatch && req.method === "POST") {
      const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(actionMatch[1]));
      if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
      const input = await body(req);
      if (actionMatch[2] === "transfers") {
        const transfer = { date: input.date || new Date().toISOString().slice(0, 10), from: pigeon.owner, to: input.to };
        pigeon.owner = input.to;
        pigeon.transfers.push(transfer);
      }
      if (actionMatch[2] === "races") {
        const date = input.date || new Date().toISOString().slice(0, 10);
        pigeon.races.push({
          date, event: input.event, distance: Number(input.distance || 0),
          returnTime: input.returnTime || "", rank: Number(input.rank || 0),
          status: "reconciled", owner: ownerAt(pigeon, date)
        });
      }
      if (actionMatch[2] === "vaccines") pigeon.vaccines.push({ date: input.date || new Date().toISOString().slice(0, 10), name: input.name });
      await saveDb(db);
      return sendJson(res, 200, pigeon);
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
