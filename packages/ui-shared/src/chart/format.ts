// Number formatting fallback for charts. Hosts pass their own formatter
// (Calc: the core's number formats); this one covers General and the
// plain 0 / 0.00 / #,##0 / percent codes.

/** Excel's General for chart labels: up to 10 significant digits, no trailing zeros. */
export function formatGeneral(v: number): string {
  if (!Number.isFinite(v)) return "#NUM!";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e11 || a < 1e-9) return v.toExponential(2).toUpperCase();
  return String(Number(v.toPrecision(10)));
}

/** A small formatter for the codes charts use most; anything else falls back to General. */
export function basicFormat(v: number, code: string): string {
  const c = code.trim();
  if (c === "" || c.toLowerCase() === "general") return formatGeneral(v);
  const m = /^(#,##0|0)(\.(0+))?(%?)$/.exec(c.replace(/"[^"]*"|\\./g, ""));
  if (!m) return formatGeneral(v);
  const pct = m[4] === "%";
  const dec = m[3]?.length ?? 0;
  const x = pct ? v * 100 : v;
  let s = Math.abs(x).toFixed(dec);
  if (m[1] === "#,##0") {
    const [i, f] = s.split(".");
    s = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
  }
  return `${x < 0 && Number(s.replace(/,/g, "")) !== 0 ? "-" : ""}${s}${pct ? "%" : ""}`;
}
