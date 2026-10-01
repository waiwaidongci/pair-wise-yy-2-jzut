// 档案存取：鸽只档案的读写、血统关系、父母环号回填、转让记录
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");

const seed = {
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ],
  // 离线成绩包（含冲突包，保留后可重试）
  scorePackages: [],
  // 对账后的正式成绩（与 pigeons[].races 同源维护）
  reconciledRaces: []
};

// 旧数据补齐：父母环号字段缺失 / 新增集合缺失时补默认值
function normalize(db) {
  for (const pigeon of db.pigeons || []) {
    for (const key of ["vaccines", "transfers", "races"]) {
      if (!Array.isArray(pigeon[key])) pigeon[key] = [];
    }
    if (!pigeon.fatherRing) pigeon.fatherRing = pigeon.fatherRing || "";
    if (!pigeon.motherRing) pigeon.motherRing = pigeon.motherRing || "";
    // 历史直接录入的成绩默认视为对账通过
    for (const race of pigeon.races) {
      if (!race.status) race.status = "reconciled";
      if (!race.ownerAtResult) race.ownerAtResult = pigeon.owner;
    }
  }
  if (!Array.isArray(db.scorePackages)) db.scorePackages = [];
  if (!Array.isArray(db.reconciledRaces)) db.reconciledRaces = [];
  return db;
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return normalize(structuredClone(seed));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  return normalize(db);
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function findPigeon(db, ringNo) {
  return db.pigeons.find(item => item.ringNo === ringNo) || null;
}

export function relation(db, ringNo) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return null;
  const father = findPigeon(db, pigeon.fatherRing) || null;
  const mother = findPigeon(db, pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

// 父母环号回填：旧数据缺环号才补，已登记的父母不能被覆盖。返回是否发生回填。
export function backfillParents(pigeon, patch) {
  let changed = false;
  if (!pigeon.fatherRing && patch.fatherRing) {
    pigeon.fatherRing = patch.fatherRing;
    changed = true;
  }
  if (!pigeon.motherRing && patch.motherRing) {
    pigeon.motherRing = patch.motherRing;
    changed = true;
  }
  return changed;
}
