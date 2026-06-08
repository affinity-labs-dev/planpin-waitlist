/* PlanPin internal metrics dashboard.
 * Calls the password-gated public.dashboard_metrics(<password>) RPC with the
 * public anon key. Data sources = Supabase Auth (users) + the app tables the
 * PlanPin app writes (trips, user_spots, ingest_runs, billing_events, posts,
 * spots, creators, instagram_links). Aggregates only - no PII. The top-right
 * dropdown re-windows every chart client-side. */

const SUPABASE_URL = "https://jszwnlyrvpuiiifdqtyn.supabase.co";
// Public anon key - safe to embed (already shipped in the site for the waitlist).
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzendubHlydnB1aWlpZmRxdHluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjQ3MDIsImV4cCI6MjA5MTMwMDcwMn0.E24UDFVtjZAisLyybTKoOlZwFokenTxyw1hcAPgJ1Wk";
const RPC_URL = SUPABASE_URL + "/rest/v1/rpc/dashboard_metrics";
const PW_KEY = "pp_dash_pw";

const C = { olive:"#9BA83A", oliveD:"#7E8C2C", navy:"#1F2A44", amber:"#C9A227", red:"#B3261E",
            grid:"rgba(13,13,13,.06)", tick:"#5C5C5C" };

let DATA = null;
let activeTab = "overview";
const charts = {};

/* ---------- date helpers (ISO 'YYYY-MM-DD', UTC, lexicographic-safe) ---------- */
const pad = n => String(n).padStart(2, "0");
const isoDay = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const todayISO = () => isoDay(new Date());
function addDaysISO(iso, n){ const d = new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return isoDay(d); }
function rangeDays(startISO, endISO){ const out=[]; let c=startISO; while(c<=endISO){ out.push(c); c=addDaysISO(c,1);} return out; }
const fmtDay = iso => { const [,m,d]=iso.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1]} ${+d}`; };
const nf = n => (n==null ? "-" : Number(n).toLocaleString("en-US"));

/* ---------- gate + show/hide password ---------- */
const gate = document.getElementById("gate");
const gateErr = document.getElementById("gateErr");
const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const pwInput = document.getElementById("pw");
const pwEye = document.getElementById("pwEye");
pwEye.innerHTML = EYE;
pwEye.addEventListener("click", () => {
  const show = pwInput.type === "password";
  pwInput.type = show ? "text" : "password";
  pwEye.innerHTML = show ? EYE_OFF : EYE;
  pwEye.setAttribute("aria-label", show ? "Hide password" : "Show password");
  pwInput.focus();
});

document.getElementById("gateForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pw = pwInput.value.trim();
  if (!pw) return;
  gateErr.textContent = "";
  const ok = await load(pw);
  if (ok) sessionStorage.setItem(PW_KEY, pw);
});

function showApp(){ gate.classList.add("hidden"); document.getElementById("app").classList.remove("hidden"); }

/* ---------- fetch ---------- */
async function load(pw){
  try{
    const res = await fetch(RPC_URL, {
      method:"POST",
      headers:{ apikey:ANON_KEY, Authorization:"Bearer "+ANON_KEY, "Content-Type":"application/json" },
      body: JSON.stringify({ p_password: pw }),
    });
    if (res.status === 403){ gateErr.textContent = "Wrong password."; sessionStorage.removeItem(PW_KEY); return false; }
    if (!res.ok){ gateErr.textContent = "Server error ("+res.status+")."; return false; }
    DATA = await res.json();
    showApp();
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("content").classList.remove("hidden");
    renderAll();
    return true;
  }catch(err){
    gateErr.textContent = "Network error. Check connection.";
    return false;
  }
}

/* ---------- windowing ---------- */
function currentWindow(){
  const days = +document.getElementById("range").value;          // 0 = lifetime
  const end = todayISO();
  const earliest = (DATA.series.users_daily[0]?.day) || addDaysISO(end, -90);
  const start = days === 0 ? earliest : addDaysISO(end, -(days-1));
  return { start: (days===0 ? earliest : (start < earliest ? earliest : start)), end };
}
function align(days, series, key){
  const map = new Map(series.map(r => [r.day, r[key]]));
  return days.map(d => +(map.get(d) ?? 0));
}

/* ---------- KPI tiles ---------- */
function delta(pct){
  if (pct==null) return `<span class="delta flat">-</span>`;
  const p = Number(pct);
  if (p>0) return `<span class="delta up">▲ ${p}% WoW</span>`;
  if (p<0) return `<span class="delta down">▼ ${Math.abs(p)}% WoW</span>`;
  return `<span class="delta flat">0% WoW</span>`;
}
const tile = t => `<div class="kpi"><div class="label">${t.label}</div><div class="val">${t.val}</div><div class="sub">${t.sub}</div></div>`;

// timeframe-dependent tiles. Keys match the dropdown values (days; 0 = lifetime).
const PERIOD = { "0":"all-time", "1":"last 24 hours", "7":"last 7 days", "14":"last 14 days", "30":"last 30 days", "60":"last 60 days", "90":"last 90 days" };

function renderKpis(){
  const k = DATA.kpis;
  const wk = document.getElementById("range").value;
  const W = (DATA.windows && DATA.windows[wk]) || {};
  const per = PERIOD[wk] || "selected period";
  document.getElementById("kpisUsers").innerHTML = [
    { label:"Total users",   val:nf(k.total_users),         sub:"all-time" },
    { label:"New users",     val:nf(W.new_users),           sub:per },
    { label:"Active users",  val:nf(W.active_users),        sub:per },
    { label:"Stickiness",    val:(k.stickiness_pct??0)+"%", sub:`DAU ${nf(k.dau)} / MAU ${nf(k.mau)} (rolling)` },
  ].map(tile).join("");
  document.getElementById("kpisEngagement").innerHTML = [
    { label:"Trips created",   val:nf(W.trips),        sub:per },
    { label:"Spots saved",     val:nf(W.spots_saved),  sub:per },
    { label:"Social imports",  val:nf(W.imports),      sub:`${W.import_success_pct??"-"}% success · ${per}` },
    { label:"AI credits used", val:nf(W.credits),      sub:`${nf(W.paywall_hits)} paywall hits · ${per}` },
  ].map(tile).join("");
}

function renderContent(){
  const k = DATA.kpis;
  document.getElementById("kpisContent").innerHTML = [
    { label:"Posts ingested",   val:nf(k.total_posts),    sub:"Instagram / TikTok" },
    { label:"Spots in catalog", val:nf(k.total_spots),    sub:"places extracted" },
    { label:"Creators",         val:nf(k.total_creators), sub:"in the library" },
    { label:"Instagram links",  val:nf(k.total_ig_links), sub:"accounts linked" },
  ].map(tile).join("");
}

const money = n => (n==null ? "-" : "$"+Number(n).toLocaleString("en-US"));
function renderBilling(){
  const b = DATA.billing || {};
  const el = document.getElementById("kpisBilling");
  const asOf = document.getElementById("billingAsOf");
  if (!b.source){
    el.innerHTML = `<div class="kpi"><div class="label">RevenueCat</div><div class="val">-</div><div class="sub">Not synced. Run scripts/refresh-billing.mjs</div></div>`;
    asOf.textContent = "Not synced yet"; return;
  }
  el.innerHTML = [
    { label:"Active subscriptions",    val:nf(b.active_subscriptions),   sub:"scheduled to keep paying" },
    { label:"Cancelled subscriptions", val:nf(b.cancelled_subscriptions),sub:"active term, won't renew" },
    { label:"Paying customers",        val:nf(b.paying_customers),       sub:"have a paid plan now" },
    { label:"Active trials",           val:nf(b.active_trials),          sub:"in trial now" },
    { label:"MRR",                     val:money(b.mrr),                 sub:"monthly recurring" },
    { label:"ARR",                     val:money(b.arr),                 sub:"annual run-rate" },
    { label:"Revenue · 28d",           val:money(b.revenue_28d),         sub:"collected, last 28 days" },
    { label:"Paywall conversion",      val:(b.paywall_conversion_pct==null?"-":b.paywall_conversion_pct+"%"), sub:`${nf(b.paywall_hitters)} hit paywall` },
  ].map(tile).join("");
  const at = DATA.billing_updated_at ? new Date(DATA.billing_updated_at).toLocaleString() : "-";
  asOf.textContent = `From RevenueCat · synced ${at}`;
}

/* ---------- charts ---------- */
// Shared hover tooltip - hovering anywhere on a date shows that day's value(s).
const TT = {
  enabled:true, backgroundColor:"#1F2A44", titleColor:"#fff", bodyColor:"#fff",
  padding:10, cornerRadius:8, displayColors:true, usePointStyle:true, boxWidth:8, boxHeight:8,
  titleFont:{ family:"Bricolage Grotesque", size:12, weight:"600" },
  bodyFont:{ family:"Bricolage Grotesque", size:12 },
  callbacks:{ label: ctx => ` ${ctx.dataset.label ? ctx.dataset.label+": " : ""}${(ctx.parsed.y ?? 0).toLocaleString("en-US")}` }
};
const baseOpts = (stacked=false) => ({
  responsive:true, maintainAspectRatio:false,
  interaction:{ mode:"index", intersect:false },
  plugins:{ legend:{ display:false }, tooltip:TT },
  scales:{
    x:{ stacked, grid:{ display:false }, ticks:{ color:C.tick, maxRotation:0, autoSkip:true, maxTicksLimit:8, font:{ family:"Bricolage Grotesque", size:10 } } },
    y:{ stacked, beginAtZero:true, grid:{ color:C.grid }, ticks:{ color:C.tick, precision:0, font:{ family:"Bricolage Grotesque", size:10 } } }
  }
});
const legendOpts = base => ({ ...base, plugins:{ legend:{ display:true, position:"bottom", labels:{ boxWidth:10, font:{ family:"Bricolage Grotesque", size:10 }, color:C.tick } }, tooltip:TT } });
function draw(id, cfg){ if(charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
const bar  = (labels,data) => ({ type:"bar",  data:{ labels, datasets:[{ data, backgroundColor:C.olive, hoverBackgroundColor:C.oliveD, borderRadius:3, maxBarThickness:26 }]}, options:baseOpts() });
const line = (labels,data,color) => ({ type:"line", data:{ labels, datasets:[{ data, borderColor:color, backgroundColor:color==C.navy?"rgba(31,42,68,.10)":"rgba(155,168,58,.16)", fill:true, tension:.25, pointRadius:0, pointHoverRadius:4, pointHitRadius:12, pointHoverBackgroundColor:color, pointHoverBorderColor:"#fff", pointHoverBorderWidth:2, borderWidth:2 }]}, options:baseOpts() });

function renderCharts(){ if (activeTab === "financial") renderFinancialCharts(); else renderOverviewCharts(); }

function renderOverviewCharts(){
  const { start, end } = currentWindow();
  const days = rangeDays(start, end);
  const labels = days.map(fmtDay);
  const s = DATA.series;

  draw("cUsers", bar(labels, align(days, s.users_daily, "new_users")));

  // Cumulative users: running total over full history, sliced to the window.
  let run=0; const cum=new Map();
  for (const r of s.users_daily){ run+=r.new_users; cum.set(r.day, run); }
  let last=0; const cumVals=days.map(d=>{ if(cum.has(d)) last=cum.get(d); return last; });
  draw("cCumulative", { type:"line", data:{ labels, datasets:[{ data:cumVals, borderColor:C.navy, backgroundColor:"rgba(31,42,68,.10)", fill:true, tension:.25, pointRadius:0, pointHoverRadius:4, pointHitRadius:12, pointHoverBackgroundColor:C.navy, pointHoverBorderColor:"#fff", pointHoverBorderWidth:2, borderWidth:2 }]}, options:baseOpts() });

  draw("cActive",  line(labels, align(days, s.active_daily, "active_users"), C.oliveD));
  draw("cTrips",   bar(labels, align(days, s.trips_daily, "trips_created")));
  draw("cSaves",   bar(labels, align(days, s.saves_daily, "spots_saved")));

  draw("cImports", { type:"bar", data:{ labels, datasets:[
    { label:"Success", data:align(days,s.imports_daily,"success"), backgroundColor:C.olive, maxBarThickness:26 },
    { label:"Partial", data:align(days,s.imports_daily,"partial"), backgroundColor:C.amber, maxBarThickness:26 },
    { label:"Failed",  data:align(days,s.imports_daily,"failed"),  backgroundColor:C.red,   maxBarThickness:26 },
  ]}, options:legendOpts(baseOpts(true)) });
}

function renderFinancialCharts(){
  const b = DATA.billing || {};
  const tE = Object.entries(b.tiers || {});
  draw("cTiers", { type:"doughnut",
    data:{ labels: tE.length ? tE.map(e=>e[0]) : ["No active subs"],
           datasets:[{ data: tE.length ? tE.map(e=>e[1]) : [1],
                       backgroundColor:[C.olive,C.navy,C.amber,C.oliveD,C.red,"#c9c2ad"], borderWidth:0 }]},
    options:{ responsive:true, maintainAspectRatio:false, cutout:"58%",
      plugins:{ legend:{ position:"bottom", labels:{ font:{family:"Bricolage Grotesque",size:11}, color:C.tick, padding:12 } },
                tooltip:{ ...TT, callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.parsed}` } } } } });

  const h = DATA.billing_history || [];
  const hl = h.map(r => fmtDay(r.snapshot_date));
  const trend = (id, key, color) => draw(id, { type:"line",
    data:{ labels:hl, datasets:[{ data:h.map(r=>Number(r[key])||0), borderColor:color,
      backgroundColor: color===C.navy ? "rgba(31,42,68,.10)" : "rgba(155,168,58,.16)",
      fill:true, tension:.25, pointRadius:3, pointHoverRadius:5, borderWidth:2 }]}, options:baseOpts() });
  trend("cMrr", "mrr", C.navy);
  trend("cSubs", "active_subscriptions", C.oliveD);

  const { start, end } = currentWindow();
  const days = rangeDays(start, end);
  draw("cPaywall", bar(days.map(fmtDay), align(days, DATA.series.paywall_daily || [], "paywall_hits")));
}

function initTabs(){
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tab;
      if (t === activeTab) return;
      activeTab = t;
      document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
      document.getElementById("pane-overview").classList.toggle("hidden", t !== "overview");
      document.getElementById("pane-financial").classList.toggle("hidden", t !== "financial");
      if (DATA) renderCharts();   // canvases must be visible to size correctly
    });
  });
}

/* ---------- activation ---------- */
function renderFunnel(){
  const f = DATA.funnel;
  const total = f.users || 1;
  const rows = [
    ["Signed up",       f.users],
    ["Took any action", f.activated],
    ["Created a trip",  f.made_trip],
    ["Saved a spot",    f.saved],
    ["Imported (ingest)", f.imported],
    ["Used AI credits", f.used_ai],
    ["Paid",            f.paid],
  ];
  document.getElementById("funnel").innerHTML = rows.map(([lab,n])=>{
    const pct = Math.round(((n||0)/total)*100);
    return `<div class="frow"><div>${lab}</div>
      <div class="fbar-track"><div class="fbar" style="width:${Math.max(pct,1)}%"></div></div>
      <div class="fmeta"><b>${nf(n)}</b> · ${pct}%</div></div>`;
  }).join("");
}

/* ---------- orchestration ---------- */
function renderAll(){
  renderKpis();
  renderContent();
  renderBilling();
  renderCharts();
  renderFunnel();
  const g = DATA.generated_at ? new Date(DATA.generated_at).toLocaleString() : "-";
  document.getElementById("foot").textContent = `Live from Supabase · updated ${g}`;
}

document.getElementById("range").addEventListener("change", () => { if (DATA){ renderKpis(); renderCharts(); } });
document.getElementById("refresh").addEventListener("click", () => {
  const pw = sessionStorage.getItem(PW_KEY); if (pw) load(pw);
});

initTabs();
(function init(){ const pw = sessionStorage.getItem(PW_KEY); if (pw) load(pw); })();
