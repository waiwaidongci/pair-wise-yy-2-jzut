import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const dbPath = join(__dirname, "..", "data", "pigeons.json");

export const seed = {
  pigeons: [
    {
      ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚",
      vaccines: [{ date: "2026-04-01", name: "新城疫" }],
      transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }],
      races: [
        { date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18, status: "reconciled", owner: "北岸棚", packageId: "pkg-seed-001" },
        { date: "2026-06-15", event: "200公里训放", distance: 200, returnTime: "11:20", rank: 5, status: "conflict", owner: "北岸棚", packageId: "pkg-seed-003" },
        { date: "2026-06-22", event: "30公里训放", distance: 30, returnTime: "10:05", rank: 0, status: "pending", owner: "北岸棚", packageId: "pkg-seed-005" }
      ]
    },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ],
  packages: [
    {
      id: "pkg-seed-001", source: "计时员甲", submittedAt: "2026-06-02T09:00:00.000Z",
      fingerprint: "计时员甲::CHN-2026-001|2026-06-01|120公里训放|10:42|120",
      status: "reconciled", conflicts: [],
      results: [{ ringNo: "CHN-2026-001", date: "2026-06-01", event: "120公里训放", status: "reconciled", duplicate: false, backfilled: [] }]
    },
    {
      id: "pkg-seed-002", source: "计时员乙", submittedAt: "2026-06-02T09:02:00.000Z",
      fingerprint: "计时员乙::CHN-2026-001|2026-06-01|120公里训放|10:42|120",
      status: "reconciled", conflicts: [],
      results: [{ ringNo: "CHN-2026-001", date: "2026-06-01", event: "120公里训放", status: "reconciled", duplicate: true, backfilled: [] }]
    },
    {
      id: "pkg-seed-003", source: "计时员甲", submittedAt: "2026-06-15T18:00:00.000Z",
      fingerprint: "计时员甲::CHN-2026-001|2026-06-15|200公里训放|11:20|200",
      status: "conflict",
      conflicts: [{ ringNo: "CHN-2026-001", reason: "time_conflict", date: "2026-06-15", event: "200公里训放", times: ["11:20", "11:35"], message: "同场比赛归巢时间不一致，仅保留最早有效时间 11:20" }],
      results: [{ ringNo: "CHN-2026-001", date: "2026-06-15", event: "200公里训放", status: "conflict", duplicate: false, backfilled: [] }]
    },
    {
      id: "pkg-seed-004", source: "计时员乙", submittedAt: "2026-06-15T18:05:00.000Z",
      fingerprint: "计时员乙::CHN-2026-001|2026-06-15|200公里训放|11:35|200",
      status: "conflict",
      conflicts: [{ ringNo: "CHN-2026-001", reason: "time_conflict", date: "2026-06-15", event: "200公里训放", times: ["11:20", "11:35"], message: "同场比赛归巢时间不一致，仅保留最早有效时间 11:20" }],
      results: [{ ringNo: "CHN-2026-001", date: "2026-06-15", event: "200公里训放", status: "conflict", duplicate: false, backfilled: [] }]
    },
    {
      id: "pkg-seed-005", source: "计时员甲", submittedAt: "2026-06-22T12:00:00.000Z",
      fingerprint: "计时员甲::CHN-2026-001|2026-06-22|30公里训放|10:05|30",
      status: "pending", conflicts: [],
      results: [{ ringNo: "CHN-2026-001", date: "2026-06-22", event: "30公里训放", status: "pending", duplicate: false, backfilled: [] }]
    }
  ]
};

export function ownerAt(pigeon, date) {
  if (!date) return pigeon.owner;
  const past = pigeon.transfers
    .filter(t => t.date && t.date <= date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (past.length) return past[past.length - 1].to;
  const first = [...pigeon.transfers].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  return first ? first.from : pigeon.owner;
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.pigeons ??= [];
  db.packages ??= [];
  for (const pigeon of db.pigeons) {
    pigeon.vaccines ??= [];
    pigeon.transfers ??= [];
    pigeon.races ??= [];
    for (const race of pigeon.races) {
      race.status ??= "reconciled";
      race.owner ??= ownerAt(pigeon, race.date);
    }
  }
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}
