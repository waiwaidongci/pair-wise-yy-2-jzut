// 成绩对账：离线成绩包去重、双计时员核对、转让后归属、正式成绩入账
import { backfillParents, findPigeon } from "./store.js";

// 两位计时员归巢时间差在该阈值内视为对账通过，否则为冲突
export const TIME_TOLERANCE_SECONDS = 300;

export const STATUS = {
  RECONCILED: "reconciled", // 对账通过
  PENDING: "pending",       // 待核验（仅一位计时员提交）
  CONFLICT: "conflict"      // 冲突（时间不符 / 鸽只未登记 / 时间无效）
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

// 支持 "HH:MM"、"HH:MM:SS" 及完整时间字符串，返回当日秒数；无法解析返回 null
export function parseTimeSeconds(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  const hm = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60 + Number(hm[3] || 0);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  return null;
}

function secondsToText(value) {
  const h = String(Math.floor(value / 3600)).padStart(2, "0");
  const m = String(Math.floor((value % 3600) / 60)).padStart(2, "0");
  const s = value % 60;
  return s ? `${h}:${m}:${String(s).padStart(2, "0")}` : `${h}:${m}`;
}

// 单条提交校验，就地补状态与原因
function validateSubmission(db, item) {
  item.ringNo = String(item.ringNo || "").trim();
  item.event = String(item.event || "").trim();
  item.date = item.date || today();
  item.timer = String(item.timer || "未署名计时员").trim();
  item.distance = Number(item.distance || 0);
  item.rank = Number(item.rank || 0);
  item.returnSeconds = parseTimeSeconds(item.returnTime);

  const pigeon = findPigeon(db, item.ringNo);
  if (!item.ringNo || !item.event) {
    item.status = STATUS.CONFLICT;
    item.reason = "missing_field";
    return;
  }
  if (!pigeon) {
    item.status = STATUS.CONFLICT;
    item.reason = "unknown_pigeon";
    return;
  }
  if (item.returnSeconds === null) {
    item.status = STATUS.CONFLICT;
    item.reason = "invalid_time";
    return;
  }
  // 成绩归属快照：仅在提交首次入库时按当前鸽主固化，转让不影响在途成绩
  if (!item.ownerAtResult) item.ownerAtResult = pigeon.owner;
  // 顺手回填旧档案缺失的父母环号（已登记的不覆盖）
  backfillParents(pigeon, item);
}

// 收集全部成绩包中的有效提交，按 鸽只+比赛日期+赛事 分组
function collectGroups(db) {
  const groups = new Map();
  for (const pkg of db.scorePackages) {
    for (const item of pkg.items || []) {
      if (item.status === STATUS.CONFLICT && (!item.ringNo || !item.event)) continue;
      const key = `${item.ringNo}|${item.date}|${item.event}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
  }
  return groups;
}

function aggregatePackageStatus(pkg) {
  const statuses = (pkg.items || []).map(item => item.status);
  if (statuses.includes(STATUS.CONFLICT)) pkg.status = STATUS.CONFLICT;
  else if (statuses.length && statuses.every(s => s === STATUS.RECONCILED)) pkg.status = STATUS.RECONCILED;
  else pkg.status = STATUS.PENDING;
}

// 全量重新对账并把正式成绩同步进 pigeons[].races
export function reconcile(db) {
  const groups = collectGroups(db);
  const summaries = [];

  // 重置由成绩包入账的正式成绩，重新生成（手工录入的不动）
  for (const pigeon of db.pigeons) {
    pigeon.races = pigeon.races.filter(race => race.source !== "package");
  }

  for (const [key, items] of groups) {
    const [ringNo, date, event] = key.split("|");
    const pigeon = findPigeon(db, ringNo);
    const invalid = items.filter(item => item.status === STATUS.CONFLICT);
    const valid = items
      .filter(item => item.status !== STATUS.CONFLICT)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

    let status;

    // 同一位计时员重复提交只算一次（以首次提交为准），多余的标记为重复
    const byTimer = new Map();
    for (const item of valid) {
      if (!byTimer.has(item.timer)) byTimer.set(item.timer, item);
    }
    const uniques = [...byTimer.values()];
    for (const item of valid) {
      if (byTimer.get(item.timer) !== item) item.reason = "duplicate_timer";
    }
    for (const item of invalid) item.status = STATUS.CONFLICT;

    // 仅按各计时员的首次有效提交判定
    if (!pigeon || invalid.length === items.length) {
      status = STATUS.CONFLICT;
    } else if (uniques.length <= 1) {
      status = STATUS.PENDING; // 只有一位计时员，等待第二位核验
    } else {
      const earliest = Math.min(...uniques.map(v => v.returnSeconds));
      const latest = Math.max(...uniques.map(v => v.returnSeconds));
      status = latest - earliest <= TIME_TOLERANCE_SECONDS ? STATUS.RECONCILED : STATUS.CONFLICT;
    }
    for (const item of valid) {
      item.status = status;
      if (item.reason !== "duplicate_timer") item.reason = undefined;
    }

    const summary = {
      ringNo, date, event,
      distance: valid[0]?.distance ?? invalid[0]?.distance ?? 0,
      status,
      submissions: items.map(item => ({
        timer: item.timer,
        returnTime: item.returnTime ?? null,
        ownerAtResult: item.ownerAtResult || null,
        packageId: item.packageId,
        status: item.status,
        reason: item.reason
      }))
    };

    // 对账通过才正式入账，保留最早有效归巢时间，归属取最早提交时的鸽主
    if (status === STATUS.RECONCILED && pigeon && valid.length) {
      const earliestItem = valid.reduce((a, b) =>
        a.returnSeconds <= b.returnSeconds ? a : b);
      pigeon.races.push({
        date, event,
        distance: earliestItem.distance,
        returnTime: secondsToText(earliestItem.returnSeconds),
        rank: earliestItem.rank,
        status: STATUS.RECONCILED,
        ownerAtResult: earliestItem.ownerAtResult,
        source: "package",
        timer: [...new Set(valid.map(v => v.timer))].join("、")
      });
      summary.returnTime = secondsToText(earliestItem.returnSeconds);
      summary.ownerAtResult = earliestItem.ownerAtResult;
    }
    summaries.push(summary);
  }

  for (const pkg of db.scorePackages) aggregatePackageStatus(pkg);
  return summaries;
}

// 接入一个离线成绩包；重复包只入一次
export function ingestPackage(db, payload) {
  const packageId = String(payload.packageId || "").trim();
  if (!packageId) throw Object.assign(new Error("packageId_required"), { status: 400 });

  const existing = db.scorePackages.find(pkg => pkg.packageId === packageId);
  if (existing) {
    return { duplicate: true, package: existing, groups: reconcile(db) };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const pkg = {
    packageId,
    receivedAt: new Date().toISOString(),
    status: STATUS.PENDING,
    items: items.map(item => ({
      ...item,
      packageId,
      receivedAt: new Date().toISOString()
    }))
  };
  for (const item of pkg.items) validateSubmission(db, item);

  db.scorePackages.push(pkg);
  const groups = reconcile(db);
  return { duplicate: false, package: pkg, groups };
}

// 冲突包重试：保留包记录，重新校验（鸽只补登记 / 父母回填 / 归属快照）并全量对账
export function retryPackage(db, packageId) {
  const pkg = db.scorePackages.find(item => item.packageId === packageId);
  if (!pkg) return null;
  for (const item of pkg.items) {
    item.status = undefined;
    item.reason = undefined;
    item.returnSeconds = undefined;
    validateSubmission(db, item);
  }
  pkg.retriedAt = new Date().toISOString();
  const groups = reconcile(db);
  return { package: pkg, groups };
}

// 给血统页用：汇总某只鸽的待核验 / 冲突成绩（正式成绩已在 pigeon.races 中）
export function pendingResultsFor(db, ringNo) {
  const result = [];
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return result;
  for (const [key, items] of collectGroups(db)) {
    const [ring, d, ev] = key.split("|");
    if (ring !== ringNo) continue;
    // 已正式入账的对账通过成绩不重复列出
    if (pigeon.races.some(race => race.source === "package" && race.date === d && race.event === ev)) continue;
    const valid = items.filter(item => item.status !== STATUS.CONFLICT);
    if (!valid.length) {
      result.push({ date: d, event: ev, status: STATUS.CONFLICT, reason: items[0]?.reason, submissions: items });
      continue;
    }
    const earliest = Math.min(...valid.map(v => v.returnSeconds));
    const latest = Math.max(...valid.map(v => v.returnSeconds));
    const status = valid.length <= 1
      ? STATUS.PENDING
      : (latest - earliest <= TIME_TOLERANCE_SECONDS ? STATUS.RECONCILED : STATUS.CONFLICT);
    if (status === STATUS.RECONCILED) continue;
    result.push({
      date: d,
      event: ev,
      status,
      returnTime: secondsToText(earliest),
      ownerAtResult: valid.find(v => v.returnSeconds === earliest)?.ownerAtResult,
      submissions: items
    });
  }
  return result;
}
