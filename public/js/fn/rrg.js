import { api, esc, num } from "../api.js";
import { table, html, tabs, sect } from "../ui.js";
import { toSecurity } from "../securities.js";
import { DEFAULT_WATCH } from "./workspace.js";
export const COLORS = { Leading: "#40d889", Weakening: "#ebc34d", Lagging: "#ef6974", Improving: "#7f9cff", Neutral: "#aaaaaa" };
import { sortableTable } from "../sortable-table.js";
export { sortedRows, nextSort } from "../sortable-table.js";
function sortableRanking(rows, cols, onRow, panel) {
  return sortableTable(rows, cols, { onRow, initialSort: panel.rrgSort || { key: "rsl", direction: "desc" }, onSort: sort => { panel.rrgSort = sort; } });
}
export function parseArgs(args) {
  const out = { mode: "SECTORS", tf: "WEEKLY", benchmark: "SPY", tails: 8 };
  for (const a of args) {
    const s = a.toUpperCase();
    if (["SECTORS", "LARGE", "W", "CUSTOM", "WEI", "PORT"].includes(s)) out.mode = s;
    else if (["WEEKLY", "DAILY"].includes(s)) out.tf = s;
    else if (s.startsWith("BENCH=")) out.benchmark = s.slice(6);
    else if (s.startsWith("TAIL=")) out.tails = s.slice(5);
    else { out.symbols = [out.symbols, s].filter(Boolean).join(","); out.mode = "CUSTOM"; }
  }
  return out;
}
// PORT stores Bloomberg-style security codes, quantities and costs; RRG only needs open-position symbols.
export function portfolioSymbols(holdings) {
  if (!Array.isArray(holdings)) return [];
  return [...new Set(holdings.filter(h => h && Number.isFinite(Number(h.shares)) && Number(h.shares) !== 0)
    .map(h => toSecurity(String(h.sec || "").trim().toUpperCase().split(/\s+/).filter(Boolean))?.id).filter(Boolean))];
}
const command = o => `RRG ${o.mode} ${o.tf} BENCH=${o.benchmark} TAIL=${o.tails}${o.mode === "CUSTOM" ? ` ${o.symbols || ""}` : ""}`;
export function svgPlot(rows) {
  const valid = rows.filter(r => !r.error);
  const points = valid.flatMap(r => r.tail);
  const dx = Math.max(2, ...points.map(p => Math.abs(p.x - 100))) * 1.2;
  const dy = Math.max(1, ...points.map(p => Math.abs(p.y - 100))) * 1.2;
  const x = v => 260 + (v - 100) / dx * 210;
  const y = v => 235 - (v - 100) / dy * 185;
  const labels = [[55, 38, "Improving"], [365, 38, "Leading"], [55, 448, "Lagging"], [357, 448, "Weakening"]];
  return `<svg viewBox="0 0 520 500" role="img" aria-label="Relative strength versus momentum rotation plot" style="width:100%;max-height:650px;font:11px monospace">
  <rect x="45" y="20" width="215" height="215" fill="#14213a"/><rect x="260" y="20" width="215" height="215" fill="#0c291c"/>
  <rect x="45" y="235" width="215" height="225" fill="#301419"/><rect x="260" y="235" width="215" height="225" fill="#302810"/>
  <path d="M45 235H475 M260 20V460" stroke="#777" stroke-width="1"/>
  ${[-1,-0.5,0,0.5,1].map(t => `<text x="${x(100+t*dx)}" y="476" text-anchor="middle" fill="#aaa">${(100+t*dx).toFixed(1)}</text><text x="40" y="${y(100+t*dy)+4}" text-anchor="end" fill="#aaa">${(100+t*dy).toFixed(1)}</text>`).join("")}
  ${labels.map(([x,y,k]) => `<text x="${x}" y="${y}" fill="${COLORS[k]}">${k.toUpperCase()}</text>`).join("")}
  <text x="260" y="497" fill="#ffad32" text-anchor="middle">RS-Ratio →</text><text transform="translate(12 235) rotate(-90)" fill="#ffad32" text-anchor="middle">RS-Momentum →</text>
  ${valid.map(r => `<g data-symbol="${esc(r.symbol)}" tabindex="0" role="button" aria-label="Open ${esc(r.symbol)} chart" style="cursor:pointer" opacity="${r.stale ? 0.45 : 1}"><title>${esc(r.symbol)} — ${r.quadrant} — ${r.date}${r.stale ? " (stale)" : ""}; oldest to newest, large dot is latest</title><polyline points="${r.tail.map(p => `${x(p.x)},${y(p.y)}`).join(" ")}" fill="none" stroke="${COLORS[r.quadrant]}" stroke-width="1.6"/>${r.tail.map((p,i) => `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${i === r.tail.length-1 ? 4 : 1.8}" fill="${COLORS[r.quadrant]}" opacity="${0.3 + 0.7*(i+1)/r.tail.length}"><title>${p.date}: ${num(p.x)}, ${num(p.y)}</title></circle>`).join("")}<text x="${Math.min(478,x(r.x)+7)}" y="${y(r.y)-7}" fill="${COLORS[r.quadrant]}">${esc(r.symbol)}</text></g>`).join("")}</svg>`;
}
export default [{
  id: "RRG", name: "Relative rotation and strength", group: "Markets",
  source: "Existing chart providers (Yahoo Finance / Nasdaq); price closes; documented RRG approximation",
  async render(ctx) {
    const o = parseArgs(ctx.args);
    if (o.mode === "PORT") {
      const state = await api.get("/api/state");
      if (!ctx.live()) return;
      const symbols = portfolioSymbols(state.amberPort);
      if (!symbols.length) throw new Error("Your PORT portfolio has no open positions. Add or import holdings in PORT first.");
      o.symbols = symbols.join(",");
    }
    if (o.mode === "W") {
      const state = await api.get("/api/state");
      if (!ctx.live()) return;
      o.symbols = (state.amberWatch || DEFAULT_WATCH).map(code => toSecurity(String(code).toUpperCase().split(/\s+/))?.id).filter(Boolean).join(",");
    }
    const d = await api.fn("rrg", o);
    if (!ctx.live()) return;
    ctx.el.innerHTML = "";
    ctx.setCmd(command(o));
    ctx.el.append(tabs(["SECTORS", "LARGE", "WEI", "W", "PORT"], o.mode, mode => ctx.go(command({ ...o, mode }))));
    ctx.el.append(tabs(["WEEKLY", "DAILY"], o.tf, tf => ctx.go(command({ ...o, tf }))));
    const form = html(`<form class="rrg-controls" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"><label>Benchmark <input name="benchmark" value="${esc(o.benchmark)}" size="9" required></label><label>Tail periods <input name="tails" type="number" min="1" max="52" value="${esc(o.tails)}" style="width:55px" required></label><label>Custom symbols <input name="symbols" placeholder="AMAT,SAP.DE,OMV.VI" value="${esc(o.mode === "CUSTOM" ? o.symbols : "")}" size="27"></label><button class="tab">Apply</button></form>`);
    form.onsubmit = e => { e.preventDefault(); const f = new FormData(form); const symbols = String(f.get("symbols")).trim().replace(/\s+/g, ""); ctx.go(command({ ...o, benchmark: String(f.get("benchmark")).trim().toUpperCase(), tails: f.get("tails"), ...(symbols ? { mode: "CUSTOM", symbols } : {}) })); };
    ctx.el.append(form);
    const good = d.rows.filter(r => !r.error), errors = d.rows.filter(r => r.error);
    const counts = Object.keys(COLORS).map(k => `${k} ${good.filter(r => r.quadrant === k).length}`).join(" · ");
    ctx.el.append(html(`<div class="hint">${good.length}/${d.rows.length} against ${esc(d.benchmark)}, ${d.tf.toLowerCase()}; up to ${d.tails} steps. ${esc(counts)}. Large dot = latest; click a security for its chart. Click a column heading to sort; click again to reverse.</div>`));
    const layout = html(`<div class="rrg-layout"><style>.rrg-layout{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}.rrg-chart{flex:1 1 320px;min-width:260px}.rrg-ranking{flex:1 1 430px;overflow:auto;min-width:0}</style><div class="rrg-chart">${good.length ? svgPlot(d.rows) : '<div class="err" role="status">No rotation points available. See the reasons below; check symbols, benchmark and available history.</div>'}</div><div class="rrg-ranking"></div></div>`);
    const open = symbol => ctx.go(`${symbol} GP`);
    layout.querySelectorAll("g[data-symbol]").forEach(g => { g.onclick = () => open(g.dataset.symbol); g.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(g.dataset.symbol); } }; });
    const rank = layout.querySelector(".rrg-ranking");
    rank.append(sect(`Strength ranking (RSL: ${o.tf === "WEEKLY" ? 27 : 135} periods)`), sortableRanking(good, [
      { key: "symbol", label: "Ticker", left: true }, { key: "name", label: "Name", left: true },
      { key: "rsl", label: "RSL", fmt: v => num(v,3) },
      { key: "quadrant", label: "Quadrant", left: true, html: true, fmt: v => `<span style="color:${COLORS[v]}">${v}</span>` },
      { key: "x", label: "RS-Ratio", fmt: v => num(v) }, { key: "y", label: "RS-Mom", fmt: v => num(v) },
      { key: "date", label: "Date", left: true }, { key: "stale", label: "Status", fmt: v => v ? "STALE" : "Current*" },
    ], r => open(r.symbol), ctx.panel));
    ctx.el.append(layout);
    if (o.mode === "PORT") ctx.el.append(html('<p class="hint">Your PORT holdings, one point per security. Quantities, costs and portfolio weights are not used; this is not an aggregated portfolio return. Prices are compared without FX conversion.</p>'));
    if (o.mode === "WEI") ctx.el.append(html('<p class="hint">World indices use their published local-currency series, without FX conversion. These measure local-market relative trends, not returns in a common investor currency. WEI includes VIX (volatility, not an equity market); some indices include dividends while others do not.</p>'));
    if (errors.length) ctx.el.append(sect("Unavailable securities"), table(errors, [{ key:"symbol", label:"Ticker", left:true }, { key:"error", label:"Reason", left:true, wrap:true }]));
    const notes = [...new Set([...d.benchmarkNotes, ...d.rows.flatMap(r => r.notes || [])])];
    if (notes.length) ctx.el.append(html(`<p class="hint">${notes.map(esc).join(" · ")}</p>`));
    ctx.el.append(html(`<details class="para"><summary>Method and interpretation (RRG approximation)</summary><p>RS = security close / benchmark close, matched by date. RS-Ratio = 100 × SMA(RS, S) / SMA(SMA(RS, S), B). RS-Momentum = 100 × RS-Ratio / RS-Ratio L periods earlier. Weekly S=10, B=26, L=10; daily S=50, B=130, L=50. Levy RSL = close / SMA(close, 27 weekly or 135 daily periods); this ranks absolute strength, not relative strength against the benchmark.</p><p>Above 100: relatively strong / gaining relative momentum. On either 100 axis: Neutral. Missing sessions are never filled. Weekly uses the last benchmark session of each week, including the current partial week. A gap interrupts the tail. STALE rows end before the latest benchmark period; inspect dates before comparing. *Current means the same date as the benchmark, not a guarantee of fresh or final data. Providers may send today's unfinished bar. Price return only; no dividend or currency conversion. Use compatible currencies for cross-market comparisons. These are documented approximations, not proprietary JdK values.</p><p>Commands: RRG · RRG WEI · RRG LARGE DAILY · RRG W · RRG PORT · RRG CUSTOM WEEKLY BENCH=SPY TAIL=8 AMAT,SAP.DE,OMV.VI</p></details>`));
    ctx.setSource(d.source);
  }
}];
