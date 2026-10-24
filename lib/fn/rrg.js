// Relative rotation approximation, deliberately not the proprietary JdK algorithm.
import { getCandles } from "../providers.js";
import { INDICES } from "../../public/js/securities.js";
export const WORLD_INDICES = Object.fromEntries(Object.values(INDICES));
export const SECTORS = { XLE: "Energy", XLV: "Health care", XLK: "Technology", XLP: "Consumer staples", XLF: "Financials", XLC: "Communication services", XLB: "Materials", XLY: "Consumer discretionary", XLI: "Industrials", XLRE: "Real estate", XLU: "Utilities" };
export const LARGE = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "BRK-B", "JPM", "LLY", "AVGO"];
const bad = (message) => Object.assign(new Error(message), { status: 400 });
export function options(q = {}) {
  const mode = String(q.mode || "SECTORS").toUpperCase();
  if (!["SECTORS", "LARGE", "CUSTOM", "W", "WEI", "PORT"].includes(mode)) throw bad("Unknown RRG universe");
  const tf = String(q.tf || "WEEKLY").toUpperCase();
  if (!["WEEKLY", "DAILY"].includes(tf)) throw bad("Use WEEKLY or DAILY");
  const tails = Number(q.tails ?? 8);
  if (!Number.isInteger(tails) || tails < 1 || tails > 52) throw bad("Tail length must be 1–52 periods");
  const benchmark = String(q.benchmark || "SPY").trim().toUpperCase();
  const symbols = [...new Set((mode === "SECTORS" ? Object.keys(SECTORS) : mode === "LARGE" ? LARGE : mode === "WEI" ? Object.keys(WORLD_INDICES) : String(q.symbols || "").split(",")).map(s => s.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length || symbols.length > 60) throw bad("Choose 1–60 symbols");
  if ([benchmark, ...symbols].some(s => !/^[A-Z0-9^=.:/_-]{1,60}$/.test(s))) throw bad("Invalid symbol. Use source tickers such as SAP.DE or OMV.VI");
  return { mode, tf, tails, benchmark, symbols };
}
export function daily(bars) {
  const map = new Map();
  for (const b of bars || []) if (Number.isFinite(b.time) && Number.isFinite(b.close) && b.close > 0) map.set(new Date(b.time * 1000).toISOString().slice(0, 10), b.close);
  return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
}
// Sample the benchmark's last available session each ISO week; match securities on that exact date.
export function periods(bars, tf) {
  const rows = daily(bars);
  if (tf === "DAILY") return rows;
  const weeks = new Map();
  for (const r of rows) {
    const d = new Date(r.date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    weeks.set(d.toISOString().slice(0, 10), r);
  }
  return [...weeks.values()];
}
export function quadrant(x, y) {
  if (Math.abs(x - 100) < 1e-9 || Math.abs(y - 100) < 1e-9) return "Neutral";
  return x > 100 ? (y > 100 ? "Leading" : "Weakening") : (y > 100 ? "Improving" : "Lagging");
}
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
// Weekly: smooth=10, baseline=26, momentum lag=10, Levy=27.
// Daily: 5x the weekly windows. Never fill missing sessions or compare different dates.
export function rotation(bars, benchmarkBars, tf = "WEEKLY", tails = 8) {
  const scale = tf === "DAILY" ? 5 : 1;
  const smooth = 10 * scale, base = 26 * scale, lag = 10 * scale, levy = 27 * scale;
  const prices = new Map(daily(bars).map(r => [r.date, r.close]));
  const grid = periods(benchmarkBars, tf);
  const joined = grid.map(b => ({ date: b.date, close: prices.get(b.date), benchmark: b.close }));
  const rel = joined.map(r => r.close ? r.close / r.benchmark : null);
  const means = rel.map((_, i) => {
    const w = rel.slice(Math.max(0, i - smooth + 1), i + 1);
    return w.length === smooth && w.every(v => v !== null) ? avg(w) : null;
  });
  const ratios = means.map((v, i) => {
    const w = means.slice(Math.max(0, i - base + 1), i + 1);
    return v !== null && w.length === base && w.every(x => x !== null) ? 100 * v / avg(w) : null;
  });
  const points = ratios.map((x, i) => x !== null && i >= lag && ratios[i - lag] !== null ? { date: joined[i].date, x, y: 100 * x / ratios[i - lag] } : null);
  const end = points.findLastIndex(Boolean);
  if (end < 0) return { error: `Insufficient aligned history (need ${smooth + base + lag - 1} consecutive ${tf.toLowerCase()} periods)` };
  // Do not join lines across a hole in the data.
  let start = end;
  while (start > 0 && points[start - 1] && end - start < tails) start--;
  const tail = points.slice(start, end + 1), last = tail.at(-1);
  const w = joined.slice(Math.max(0, end - levy + 1), end + 1).map(r => r.close);
  const rsl = w.length === levy && w.every(v => Number.isFinite(v)) ? joined[end].close / avg(w) : null;
  return { ...last, tail, rsl, quadrant: quadrant(last.x, last.y), stale: last.date !== grid.at(-1)?.date, benchmarkDate: grid.at(-1)?.date };
}
export async function build(q, load = getCandles) {
  const o = options(q);
  let benchmark;
  try { benchmark = await load(o.benchmark, "1D", 1500); }
  catch (e) { throw Object.assign(new Error(`Benchmark ${o.benchmark}: ${e.message}`), { status: 502 }); }
  if (!daily(benchmark.candles).length) throw Object.assign(new Error("Benchmark contains no valid closes"), { status: 502 });
  const rows = new Array(o.symbols.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
    while (next < rows.length) {
      const i = next++, symbol = o.symbols[i];
      try {
        const d = symbol === o.benchmark ? benchmark : await load(symbol, "1D", 1500);
        rows[i] = { symbol, name: SECTORS[symbol] || WORLD_INDICES[symbol] || symbol, provider: d.provider, notes: d.notes || [], ...rotation(d.candles, benchmark.candles, o.tf, o.tails) };
      } catch (e) { rows[i] = { symbol, error: e.message }; }
    }
  }));
  rows.sort((a, b) => (b.rsl ?? -Infinity) - (a.rsl ?? -Infinity));
  return { ...o, rows, benchmarkProvider: benchmark.provider, benchmarkNotes: benchmark.notes || [], source: `Daily price closes from ${[...new Set([benchmark.provider, ...rows.map(r => r.provider)].filter(Boolean))].join(", ")}; dividends not reinvested. RRG approximation, not proprietary JdK values. Latest day/week may be incomplete.` };
}
export default build;
