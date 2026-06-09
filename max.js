/* PlanPin growth snapshot — the lighter, shareable view (planpin.com/max).
 * Same password-gated public.dashboard_metrics(<password>) RPC as the full
 * dashboard, but renders only the headline user numbers + growth charts.
 * Uses its own password (a second row in reporting.dashboard_access) and its
 * own session key so it never collides with the internal dashboard. */

const SUPABASE_URL = "https://jszwnlyrvpuiiifdqtyn.supabase.co";
// Public anon key - safe to embed (already shipped in the site for the waitlist).
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzendubHlydnB1aWlpZmRxdHluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjQ3MDIsImV4cCI6MjA5MTMwMDcwMn0.E24UDFVtjZAisLyybTKoOlZwFokenTxyw1hcAPgJ1Wk";
const RPC_URL = SUPABASE_URL + "/rest/v1/rpc/dashboard_metrics";
const PW_KEY = "pp_max_pw";

const C = { olive:"#9BA83A", oliveD:"#7E8C2C", navy:"#1F2A44",
            grid:"rgba(13,13,13,.06)", tick:"#5C5C5C" };

let DATA = null;
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
const tile = t => `<div class="kpi"><div class="label">${t.label}</div><div class="val">${t.val}</div><div class="sub">${t.sub}</div></div>`;
// Keys match the dropdown values (days; 0 = lifetime).
const PERIOD = { "0":"all-time", "7":"last 7 days", "14":"last 14 days", "30":"last 30 days", "60":"last 60 days", "90":"last 90 days" };

function renderKpis(){
  const k = DATA.kpis;
  const wk = document.getElementById("range").value;
  const W = (DATA.windows && DATA.windows[wk]) || {};
  const per = PERIOD[wk] || "selected period";
  document.getElementById("heroUsers").textContent = nf(k.total_users);
  document.getElementById("kpisUsers").innerHTML = [
    { label:"New users",    val:nf(W.new_users),           sub:per },
    { label:"Active users", val:nf(W.active_users),        sub:per },
    { label:"Stickiness",   val:(k.stickiness_pct??0)+"%", sub:`DAU ${nf(k.dau)} / MAU ${nf(k.mau)} (rolling)` },
  ].map(tile).join("");
}

/* ---------- charts ---------- */
const TT = {
  enabled:true, backgroundColor:"#1F2A44", titleColor:"#fff", bodyColor:"#fff",
  padding:10, cornerRadius:8, displayColors:true, usePointStyle:true, boxWidth:8, boxHeight:8,
  titleFont:{ family:"Bricolage Grotesque", size:12, weight:"600" },
  bodyFont:{ family:"Bricolage Grotesque", size:12 },
  callbacks:{ label: ctx => ` ${ctx.dataset.label ? ctx.dataset.label+": " : ""}${(ctx.parsed.y ?? 0).toLocaleString("en-US")}` }
};
const baseOpts = () => ({
  responsive:true, maintainAspectRatio:false,
  interaction:{ mode:"index", intersect:false },
  plugins:{ legend:{ display:false }, tooltip:TT },
  scales:{
    x:{ grid:{ display:false }, ticks:{ color:C.tick, maxRotation:0, autoSkip:true, maxTicksLimit:8, font:{ family:"Bricolage Grotesque", size:10 } } },
    y:{ beginAtZero:true, grid:{ color:C.grid }, ticks:{ color:C.tick, precision:0, font:{ family:"Bricolage Grotesque", size:10 } } }
  }
});
function draw(id, cfg){ if(charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
const bar  = (labels,data) => ({ type:"bar",  data:{ labels, datasets:[{ data, backgroundColor:C.olive, hoverBackgroundColor:C.oliveD, borderRadius:3, maxBarThickness:26 }]}, options:baseOpts() });
const line = (labels,data,color) => ({ type:"line", data:{ labels, datasets:[{ data, borderColor:color, backgroundColor:color==C.navy?"rgba(31,42,68,.10)":"rgba(155,168,58,.16)", fill:true, tension:.25, pointRadius:0, pointHoverRadius:4, pointHitRadius:12, pointHoverBackgroundColor:color, pointHoverBorderColor:"#fff", pointHoverBorderWidth:2, borderWidth:2 }]}, options:baseOpts() });

function renderCharts(){
  const { start, end } = currentWindow();
  const days = rangeDays(start, end);
  const labels = days.map(fmtDay);
  const s = DATA.series;

  // Cumulative users: running total over full history, sliced to the window.
  let run=0; const cum=new Map();
  for (const r of s.users_daily){ run+=r.new_users; cum.set(r.day, run); }
  let last=0; const cumVals=days.map(d=>{ if(cum.has(d)) last=cum.get(d); return last; });
  draw("cCumulative", { type:"line", data:{ labels, datasets:[{ data:cumVals, borderColor:C.navy, backgroundColor:"rgba(31,42,68,.10)", fill:true, tension:.25, pointRadius:0, pointHoverRadius:4, pointHitRadius:12, pointHoverBackgroundColor:C.navy, pointHoverBorderColor:"#fff", pointHoverBorderWidth:2, borderWidth:2 }]}, options:baseOpts() });

  draw("cUsers",  bar(labels, align(days, s.users_daily, "new_users")));
  draw("cActive", line(labels, align(days, s.active_daily, "active_users"), C.oliveD));
}

/* ---------- orchestration ---------- */
function renderAll(){
  renderKpis();
  renderCharts();
  const g = DATA.generated_at ? new Date(DATA.generated_at).toLocaleString() : "-";
  document.getElementById("foot").textContent = `Live from Supabase · updated ${g}`;
}

document.getElementById("range").addEventListener("change", () => { if (DATA){ renderKpis(); renderCharts(); } });
document.getElementById("refresh").addEventListener("click", () => {
  const pw = sessionStorage.getItem(PW_KEY); if (pw) load(pw);
});

(function init(){ const pw = sessionStorage.getItem(PW_KEY); if (pw) load(pw); })();
