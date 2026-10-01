import { ownerAt } from "./store.js";

// 成绩对账：离线成绩包接收、重复包合并、同鸽同场最早有效归巢、
// 两位计时员交叉核验、转让期间成绩归属、血统环号回填。

export function raceKey(r) {
  return `${r.date || ""}|${r.event || ""}`;
}

// 有效归巢时间，按分钟比较；无法解析返回 null
export function validMinutes(t) {
  if (typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fingerprint(input) {
  const parts = (input.results || [])
    .map(r => `${r.ringNo || ""}|${r.date || ""}|${r.event || ""}|${r.returnTime || ""}|${r.distance || ""}`)
    .sort();
  return `${input.source || ""}::${parts.join(";")}`;
}

function recomputePackageStatus(pkg) {
  if (pkg.conflicts.length) {
    pkg.status = "conflict";
    return;
  }
  const ok = pkg.results.length > 0 && pkg.results.every(r => r.status === "reconciled" || r.duplicate);
  pkg.status = ok ? "reconciled" : "pending";
}

// 回填父母环号：只补空，已登记的父母不能覆盖；不一致记入冲突
export function backfillParents(pigeon, fatherRing, motherRing) {
  const changed = [];
  const conflicts = [];
  if (fatherRing) {
    if (!pigeon.fatherRing) {
      pigeon.fatherRing = fatherRing;
      changed.push("fatherRing");
    } else if (pigeon.fatherRing !== fatherRing) {
      conflicts.push({ field: "fatherRing", existing: pigeon.fatherRing, incoming: fatherRing });
    }
  }
  if (motherRing) {
    if (!pigeon.motherRing) {
      pigeon.motherRing = motherRing;
      changed.push("motherRing");
    } else if (pigeon.motherRing !== motherRing) {
      conflicts.push({ field: "motherRing", existing: pigeon.motherRing, incoming: motherRing });
    }
  }
  return { changed, conflicts };
}

function pushConflict(pkg, conflict) {
  const exists = pkg.conflicts.some(c =>
    c.ringNo === conflict.ringNo && c.reason === conflict.reason &&
    (c.date || "") === (conflict.date || "") && (c.event || "") === (conflict.event || ""));
  if (!exists) pkg.conflicts.push(conflict);
}

// 录入离线成绩包。重复包（同 id 或同内容指纹）只入一次。
export function ingestPackage(db, input) {
  const fp = fingerprint(input);
  if (input.id && db.packages.some(p => p.id === input.id)) {
    return { duplicate: true, reason: "id", package: db.packages.find(p => p.id === input.id) };
  }
  const dup = db.packages.find(p => p.fingerprint === fp);
  if (dup) return { duplicate: true, reason: "fingerprint", package: dup };

  const pkg = {
    id: input.id || `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: input.source || "未知来源",
    submittedAt: input.submittedAt || new Date().toISOString(),
    fingerprint: fp,
    status: "pending",
    results: [],
    conflicts: []
  };

  for (const raw of input.results || []) {
    const rec = { ringNo: raw.ringNo, date: raw.date || "", event: raw.event || "", returnTime: raw.returnTime || "", status: "pending", duplicate: false, backfilled: [] };
    const pigeon = db.pigeons.find(p => p.ringNo === raw.ringNo);
    if (!pigeon) {
      rec.status = "conflict";
      rec.reason = "pigeon_not_found";
      pushConflict(pkg, { ringNo: raw.ringNo, reason: "pigeon_not_found", message: `环号 ${raw.ringNo} 不存在，成绩无法入账` });
      pkg.results.push(rec);
      continue;
    }

    const key = raceKey(raw);
    // 成绩归属：按比赛日期确定鸽主；转让提交后，待核验成绩仍归原鸽主
    const owner = ownerAt(pigeon, raw.date);
    const existing = pigeon.races.find(r => raceKey(r) === key);
    if (existing) {
      if (existing.returnTime === (raw.returnTime || "")) {
        rec.status = "reconciled";
        rec.duplicate = true;
      } else {
        // 同鸽同场只保留最早有效归巢时间
        const oldTime = existing.returnTime;
        const inc = validMinutes(raw.returnTime);
        const cur = validMinutes(existing.returnTime);
        if (inc !== null && (cur === null || inc < cur)) existing.returnTime = raw.returnTime;
        existing.status = "conflict";
        pushConflict(pkg, {
          ringNo: raw.ringNo, reason: "time_conflict", date: raw.date, event: raw.event,
          times: [oldTime, raw.returnTime].filter(Boolean),
          message: `同场比赛归巢时间不一致，仅保留最早有效时间 ${existing.returnTime || "无"}`
        });
        rec.status = "conflict";
      }
    } else {
      const race = {
        date: raw.date || "", event: raw.event || "", distance: Number(raw.distance || 0),
        returnTime: raw.returnTime || "", rank: Number(raw.rank || 0),
        status: "pending", owner, packageId: pkg.id
      };
      pigeon.races.push(race);
      const bf = backfillParents(pigeon, raw.fatherRing, raw.motherRing);
      rec.backfilled = bf.changed;
      for (const c of bf.conflicts) {
        pushConflict(pkg, {
          ringNo: raw.ringNo, reason: "parent_conflict", field: c.field,
          existing: c.existing, incoming: c.incoming,
          message: `${c.field === "fatherRing" ? "父环号" : "母环号"} ${c.existing} 已登记，不能覆盖为 ${c.incoming}`
        });
      }
    }
    pkg.results.push(rec);
  }

  // 先入包再交叉核验，确保新包参与来源统计与状态评定
  db.packages.push(pkg);
  crossCheck(db, pkg);
  recomputePackageStatus(pkg);
  return { duplicate: false, package: pkg };
}

// 按环号+日期+赛事定位鸽只档案里的成绩记录（不存对象引用，序列化后仍可关联）
function findRace(pigeon, rec) {
  return pigeon.races.find(r => r.date === rec.date && r.event === rec.event) || null;
}

// 收集引用同一场成绩的所有来源及上报时间
function sourceTimesOf(db, pigeon, race) {
  const map = new Map();
  for (const p of db.packages) {
    for (const r of p.results) {
      if (r.ringNo === pigeon.ringNo && r.date === race.date && r.event === race.event) {
        const rr = findRace(pigeon, r);
        if (rr && !map.has(p.source)) map.set(p.source, r.returnTime);
      }
    }
  }
  return map;
}

// 评定一场成绩的对账状态：无包引用返回 null（手动录入保持原状态）
// 单一来源 → 待核验；两个及以上来源时间一致 → 对账通过；
// 时间不一致时，最早有效时间获两个及以上来源确认 → 对账通过，否则冲突。
function evaluateRace(db, pigeon, race) {
  const times = [...sourceTimesOf(db, pigeon, race).values()];
  if (!times.length) return null;
  if (times.length === 1) return "pending";
  const distinct = new Set(times);
  if (distinct.size === 1) return "reconciled";
  const earliest = times.reduce((a, b) =>
    validMinutes(a) !== null && (validMinutes(b) === null || validMinutes(a) < validMinutes(b)) ? a : b);
  return times.filter(t => t === earliest).length >= 2 ? "reconciled" : "conflict";
}

function applyRaceStatus(db, pigeon, race) {
  const status = evaluateRace(db, pigeon, race);
  if (!status) return;
  race.status = status;
  for (const p of db.packages) {
    for (const r of p.results) {
      if (r.ringNo === pigeon.ringNo && r.date === race.date && r.event === race.event) {
        r.status = status;
        if (status === "conflict") {
          const times = [...new Set(sourceTimesOf(db, pigeon, race).values())].filter(Boolean);
          pushConflict(p, {
            ringNo: r.ringNo, reason: "time_conflict", date: r.date, event: r.event, times,
            message: `两位计时员归巢时间不一致，仅保留最早有效时间 ${race.returnTime || "无"}`
          });
        }
      }
    }
    if (status === "reconciled") {
      p.conflicts = p.conflicts.filter(c =>
        !(c.reason === "time_conflict" && c.ringNo === pigeon.ringNo &&
          (c.date || "") === race.date && (c.event || "") === race.event));
    }
    recomputePackageStatus(p);
  }
}

// 与其他计时员的成绩包交叉核验
function crossCheck(db, pkg) {
  for (const rec of pkg.results) {
    const pigeon = db.pigeons.find(p => p.ringNo === rec.ringNo);
    if (!pigeon) continue;
    const race = findRace(pigeon, rec);
    if (race) applyRaceStatus(db, pigeon, race);
  }
}

// 冲突包保留后重试：重新交叉核验，数据补正后可转对账通过
export function retryPackage(db, pkg) {
  for (const rec of pkg.results) {
    const pigeon = db.pigeons.find(p => p.ringNo === rec.ringNo);
    if (!pigeon) continue;
    const race = findRace(pigeon, rec);
    if (race) applyRaceStatus(db, pigeon, race);
  }
  recomputePackageStatus(pkg);
  return pkg;
}
