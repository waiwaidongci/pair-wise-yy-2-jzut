// 页面：档案创建、血统查询、转让、成绩录入、离线成绩包对账状态展示
export function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统环号登记站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2e7d4f; --amber:#9a7b1e; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; } .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.reconciled { color:var(--green); border-color:var(--green); } .pill.pending { color:var(--amber); border-color:var(--amber); } .pill.conflict { color:var(--red); border-color:var(--red); }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .warn { color:var(--red); font-size:13px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统环号登记站</h1><div class="meta">档案、血统、转让和归巢成绩 · 离线成绩包对账</div></div><button id="reload">刷新</button></header>
  <main>
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
    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
      <div class="section">
        <h2>离线成绩包</h2>
        <div class="grid" id="packages"></div>
      </div>
      <form id="pkgForm" class="section">
        <h2>录入离线成绩包</h2>
        <label>计时员 / 来源</label><input name="source" required placeholder="计时员甲">
        <label>成绩 JSON 数组（可含父母环号 fatherRing/motherRing 用于回填）</label>
        <textarea name="results" rows="6" placeholder='[{"ringNo":"CHN-2026-001","date":"2026-06-01","event":"200公里训放","distance":200,"returnTime":"11:20","rank":3}]'></textarea>
        <button>提交成绩包</button>
      </form>
    </section>
  </main>
  <script>
    const STATUS_TEXT = { reconciled: "对账通过", pending: "待核验", conflict: "冲突" };
    const form = document.querySelector("#form");
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const search = document.querySelector("#search");
    const packagesEl = document.querySelector("#packages");
    const pkgForm = document.querySelector("#pkgForm");
    let pigeons = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function pill(status) {
      const s = status || "reconciled";
      return '<span class="pill '+s+'">'+(STATUS_TEXT[s] || s)+'</span>';
    }
    function renderCards() {
      cards.innerHTML = pigeons.map(p => '<article class="card"><h3>'+p.ringNo+'</h3><span class="pill">'+p.owner+'</span><div class="meta">'+p.color+' · '+p.loft+'</div><div>父：'+(p.fatherRing || "未登记")+'</div><div>母：'+(p.motherRing || "未登记")+'</div><label>录入转让</label><input data-to="'+p.ringNo+'" placeholder="新归属人"><button data-transfer="'+p.ringNo+'">保存转让</button><label>归巢成绩</label><input data-race="'+p.ringNo+'" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="'+p.ringNo+'">保存成绩</button><div class="section">'+p.races.map(r => '<div class="meta">'+(r.date||"")+' '+r.event+' · '+(r.returnTime||"未填时间")+' · 第'+(r.rank||0)+'名 · 鸽主:'+(r.owner||p.owner)+' · '+pill(r.status)+'</div>').join("")+'</div></article>').join("");
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer; const to = document.querySelector('[data-to="'+ringNo+'"]').value;
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/transfers', { method:'POST', body: JSON.stringify({ to }) }); await load();
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score; const raw = document.querySelector('[data-race="'+ringNo+'"]').value.split("/");
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/races', { method:'POST', body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) }); await load();
      });
    }
    function renderRelation(data) {
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、转让和成绩。</p>'; return; }
      const p = data.pigeon;
      detail.innerHTML = '<h2>'+p.ringNo+' 血统档案</h2><div class="relation"><div class="small"><b>父鸽</b><br>'+(data.father?.ringNo || p.fatherRing || "未登记")+'</div><div class="small"><b>本鸽</b><br>'+p.owner+' · '+p.color+'</div><div class="small"><b>母鸽</b><br>'+(data.mother?.ringNo || p.motherRing || "未登记")+'</div></div><div><b>子代</b> '+(data.children.map(c => c.ringNo).join("、") || "暂无")+'</div><div class="meta">转让：'+(p.transfers.map(t => t.from+"→"+t.to).join(" / ") || "暂无")+'</div><div class="meta">归巢：'+(p.races.map(r => (r.date||"")+" "+r.event+" 第"+(r.rank||0)+"名 "+(r.returnTime||"")+" · 鸽主:"+(r.owner||p.owner)+" · "+(STATUS_TEXT[r.status||"reconciled"]||"")).join(" / ") || "暂无")+'</div>';
    }
    function renderPackages(pkgs) {
      if (!pkgs.length) { packagesEl.innerHTML = '<p class="meta">暂无离线成绩包</p>'; return; }
      packagesEl.innerHTML = pkgs.map(p => '<article class="card"><h3>'+p.id+'</h3><div class="meta">来源：'+p.source+' · '+(p.submittedAt ? new Date(p.submittedAt).toLocaleString("zh-CN") : "")+'</div>'+pill(p.status)+'<div class="meta">成绩 '+p.results.length+' 条 · 重复 '+p.results.filter(r => r.duplicate).length+' 条'+(p.results.some(r => r.backfilled && r.backfilled.length) ? ' · 已回填父母环号' : '')+'</div>'+p.conflicts.map(c => '<div class="warn">⚠ '+(c.message || c.reason)+(c.times && c.times.length ? '（'+c.times.join(" vs ")+'）' : '')+'</div>').join("")+(p.status === "conflict" ? '<button data-retry="'+p.id+'">重试对账</button>' : '')+'</article>').join("");
      document.querySelectorAll("[data-retry]").forEach(btn => btn.onclick = async () => {
        await api('/api/packages/'+encodeURIComponent(btn.dataset.retry)+'/retry', { method: "POST" });
        await load();
      });
    }
    async function load(){
      pigeons = await api("/api/pigeons");
      renderCards();
      renderRelation(null);
      renderPackages(await api("/api/packages"));
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
      let results;
      try { results = JSON.parse(pkgForm.results.value || "[]"); }
      catch (e) { alert("成绩 JSON 格式错误：" + e.message); return; }
      await api("/api/packages", { method:"POST", body: JSON.stringify({ source: pkgForm.source.value, results }) });
      pkgForm.reset(); await load();
    };
    load();
  </script>
</body>
</html>`;
}
