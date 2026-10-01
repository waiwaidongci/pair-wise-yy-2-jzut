// 页面入口：档案、血统、转让、成绩以及离线成绩包对账状态
const STATUS_TEXT = {
  reconciled: "对账通过",
  pending: "待核验",
  conflict: "冲突"
};

const PACKAGE_PLACEHOLDER = `{
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
}`;

export function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统环号登记站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2e6b4f; --amber:#8a6d1d; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    textarea { min-height:150px; font-family:Menlo,Consolas,monospace; font-size:12px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#eef3f7; color:var(--accent); }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; } .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; margin-right:6px; }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .ok { color:var(--green); border-color:var(--green); background:#eef7f1; } .wait { color:var(--amber); border-color:var(--amber); background:#faf6e8; } .bad { color:var(--red); border-color:var(--red); background:#f9eeec; }
    .pkg { border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:10px; background:#fff; }
    .pkgrow { display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; }
    .msg { font-size:13px; margin-top:8px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统环号登记站</h1><div class="meta">档案、血统、转让、归巢成绩与离线包对账</div></div><button id="reload">刷新</button></header>
  <main>
    <div style="display:grid;gap:18px;align-content:start;">
      <form id="form">
        <h2>创建鸽只档案</h2>
        <label>足环号</label><input name="ringNo" required>
        <label>鸽主</label><input name="owner" required>
        <label>父鸽足环号</label><input name="fatherRing">
        <label>母鸽足环号</label><input name="motherRing">
        <label>羽色</label><input name="color" required>
        <label>出生棚号</label><input name="loft" required>
        <button>保存档案</button>
      </form>
      <form id="pkgForm" class="panel">
        <h2>上传离线成绩包</h2>
        <label>鸽会回传 JSON（重复包只入一次；缺父母环号自动回填）</label>
        <textarea name="payload" required>${PACKAGE_PLACEHOLDER}</textarea>
        <div style="margin-top:10px;"><button type="submit">接入并对账</button></div>
        <div class="msg meta" id="pkgMsg"></div>
      </form>
    </div>
    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section panel">
        <h2>待上传成绩包</h2>
        <div class="meta" style="margin-bottom:10px;">状态：<span class="pill ok">对账通过</span><span class="pill wait">待核验</span><span class="pill bad">冲突</span>（冲突包保留，修正后可重试）</div>
        <div id="packages"></div>
      </div>
      <h2 class="section">全部鸽只</h2>
      <div class="grid" id="cards"></div>
    </section>
  </main>
  <script>
    const form = document.querySelector("#form");
    const pkgForm = document.querySelector("#pkgForm");
    const pkgMsg = document.querySelector("#pkgMsg");
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const packagesEl = document.querySelector("#packages");
    const search = document.querySelector("#search");
    let pigeons = [];
    function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c])); }
    function pill(status){ return '<span class="pill '+(status==="reconciled"?"ok":status==="pending"?"wait":"bad")+'">'+({reconciled:"对账通过",pending:"待核验",conflict:"冲突"}[status]||status)+'</span>'; }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function renderCards() {
      cards.innerHTML = pigeons.map(p => '<article class="card"><h3>'+esc(p.ringNo)+'</h3><span class="pill">'+esc(p.owner)+'</span><div class="meta">'+esc(p.color)+' · '+esc(p.loft)+'</div><div>父：'+esc(p.fatherRing || "未登记")+'</div><div>母：'+esc(p.motherRing || "未登记")+'</div><div>'+(p.races||[]).map(r => esc(r.event)+" "+esc(r.returnTime||"")+" 第"+esc(r.rank)+"名 "+pill(r.status||"reconciled")).join("<br>")+'</div><label>录入转让</label><input data-to="'+esc(p.ringNo)+'" placeholder="新归属人"><button data-transfer="'+esc(p.ringNo)+'">保存转让</button><label>归巢成绩</label><input data-race="'+esc(p.ringNo)+'" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="'+esc(p.ringNo)+'">保存成绩</button></article>').join("");
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer; const to = document.querySelector('[data-to="'+ringNo+'"]').value;
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/transfers', { method:'POST', body: JSON.stringify({ to }) }); await load();
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score; const raw = document.querySelector('[data-race="'+ringNo+'"]').value.split("/");
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/races', { method:'POST', body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) }); await load();
      });
    }
    function renderPackages(pkgs) {
      if (!pkgs.length) { packagesEl.innerHTML = '<div class="meta">暂无成绩包。</div>'; return; }
      packagesEl.innerHTML = pkgs.map(pkg => '<div class="pkg"><div class="pkgrow"><div><b>'+esc(pkg.packageId)+'</b><div class="meta">'+esc((pkg.items||[]).length)+' 条提交 · 接入 '+esc(pkg.receivedAt)+'</div></div><div>'+pill(pkg.status)+(pkg.status==="conflict"?'<button class="ghost" data-retry="'+esc(pkg.packageId)+'">重试</button>':"")+'</div></div><div class="meta">'+(pkg.items||[]).map(it => esc(it.ringNo)+" "+esc(it.event)+" "+esc(it.returnTime||"无效时间")+"（"+esc(it.timer)+"）"+(it.reason?" ⚠"+esc(it.reason):"")).join("<br>")+'</div></div>').join("");
      document.querySelectorAll("[data-retry]").forEach(btn => btn.onclick = async () => {
        const r = await api('/api/score-packages/'+encodeURIComponent(btn.dataset.retry)+'/retry', { method:'POST' });
        pkgMsg.textContent = r.package.status === "conflict" ? "仍有冲突" : "重试完成："+r.package.status;
        await load();
      });
    }
    function renderRelation(data) {
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、转让和成绩。</p>'; return; }
      const p = data.pigeon;
      const races = (p.races||[]).map(r => '<div>'+esc(r.event)+' '+esc(r.returnTime||"")+' 第'+esc(r.rank)+'名 '+(r.ownerAtResult?'· 归属:'+esc(r.ownerAtResult)+" ":"")+pill(r.status||"reconciled")+'</div>').join("");
      const waiting = (data.pendingResults||[]).map(r => '<div>'+esc(r.event)+' '+(r.returnTime?esc(r.returnTime)+" ":"")+pill(r.status)+(r.reason?" ⚠"+esc(r.reason):"")+'<div class="meta">'+(r.submissions||[]).map(s => esc(s.timer)+":"+esc(s.returnTime||"无效")+"（"+esc(s.ownerAtResult||"未知鸽主")+"）").join(" / ")+'</div></div>').join("");
      detail.innerHTML = '<h2>'+esc(p.ringNo)+' 血统档案</h2><div class="relation"><div class="small"><b>父鸽</b><br>'+esc(data.father?.ringNo || p.fatherRing || "未登记")+'</div><div class="small"><b>本鸽</b><br>'+esc(p.owner)+' · '+esc(p.color)+'</div><div class="small"><b>母鸽</b><br>'+esc(data.mother?.ringNo || p.motherRing || "未登记")+'</div></div><div><b>子代</b> '+(data.children.map(c => esc(c.ringNo)).join("、") || "暂无")+'</div><div class="meta">转让：'+(p.transfers.map(t => esc(t.from)+"→"+esc(t.to)).join(" / ") || "暂无")+'</div><div class="section"><b>正式成绩</b>'+(races||"<span class='meta'>暂无</span>")+'</div><div class="section"><b>待核验 / 冲突</b>'+(waiting||"<span class='meta'>暂无</span>")+'</div>';
    }
    async function load(){
      pigeons = await api("/api/pigeons");
      renderCards();
      renderPackages(await api("/api/score-packages"));
      renderRelation(null);
    }
    document.querySelector("#searchBtn").onclick = async () => renderRelation(await api('/api/pigeons/'+encodeURIComponent(search.value)+'/relation'));
    document.querySelector("#reload").onclick = load;
    form.onsubmit = async event => {
      event.preventDefault();
      await api("/api/pigeons", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset(); await load();
    };
    pkgForm.onsubmit = async event => {
      event.preventDefault();
      try {
        const payload = JSON.parse(new FormData(pkgForm).get("payload"));
        const r = await api("/api/score-packages", { method:"POST", body: JSON.stringify(payload) });
        pkgMsg.textContent = (r.duplicate ? "重复包，只入一次。" : "成绩包已接入。")+" 状态："+r.package.status;
      } catch (e) { pkgMsg.textContent = "接入失败："+e.message; }
      await load();
    };
    load();
  </script>
</body>
</html>`;
}
