import { table } from "./ui.js";

// Compare raw numeric values, rather than formatted strings; missing values stay last in either direction.
export function sortedRows(rows, key, direction = "asc") {
  const value = r => typeof key === "function" ? key(r) : r[key];
  const missing = v => v == null || (typeof v === "number" && !Number.isFinite(v));
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    if (missing(x) || missing(y)) return missing(x) === missing(y) ? 0 : missing(x) ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" });
    return direction === "desc" ? -c : c;
  });
}
export const nextSort = (current, key) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" });
// Sort a copy for display. Each draw binds row and remove actions to that exact displayed copy.
export function sortableTable(rows, cols, { onRow, onRemove, initialSort = { key: null, direction: "asc" }, onSort } = {}) {
  const host = document.createElement("div");
  let sort = initialSort;
  function draw(focusKey) {
    const shown = sort.key == null ? [...rows] : sortedRows(rows, sort.key, sort.direction);
    const t = table(shown, cols, { onRow });
    t.querySelectorAll("thead th").forEach((th, i) => {
      const c = cols[i];
      if (c.sortable === false || typeof c.key !== "string" || !c.label) return;
      const active = c.key === sort.key;
      th.setAttribute("aria-sort", active ? sort.direction === "asc" ? "ascending" : "descending" : "none");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = active ? sort.direction === "asc" ? " ▲" : " ▼" : " ↕";
      button.setAttribute("aria-label", `Sort by ${c.label}`);
      button.title = `Sort by ${c.label}; click again to reverse`;
      button.style.cssText = "background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;padding:0 3px";
      th.style.cursor = "pointer";
      th.append(button);
      th.onclick = () => { sort = nextSort(sort, c.key); onSort?.(sort); draw(c.key); };
      if (focusKey === c.key) queueMicrotask(() => button.focus());
    });
    if (onRemove) t.addEventListener("click", e => {
      if (!e.target.closest(".xbtn")) return;
      e.stopPropagation();
      const tr = e.target.closest("tr[data-i]");
      const row = tr && shown[Number(tr.dataset.i)];
      if (row) onRemove(row);
    }, true);
    host.replaceChildren(t);
  }
  draw();
  return host;
}
