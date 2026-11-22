// Pure helpers for the monthly emails (no network, easy to test).
export const CYCLE_END_DAY = 22;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const r2 = (n) => Math.round(n * 100) / 100;
const toMin = (t) => { const p = String(t).split(":").map(Number); return p[0] * 60 + p[1]; };
export function hoursOf(e) {
  if (!e || !/^\d{2}:\d{2}$/.test(e.start || "") || !/^\d{2}:\d{2}$/.test(e.end || "")) return 0;
  const m = toMin(e.end) - toMin(e.start); return m > 0 && m <= 720 ? r2(m / 60) : 0;
}
/** Cycle = the 23rd of the previous month through the 22nd of the month the cycle ends in. */
export function cycleRange(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const endMonth = d <= CYCLE_END_DAY ? m : m + 1;
  const end = new Date(Date.UTC(y, endMonth, CYCLE_END_DAY)), start = new Date(Date.UTC(y, endMonth - 1, CYCLE_END_DAY + 1));
  return { start: ymd(start), end: ymd(end), endLabel: end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) };
}
const wrap = (title, body, site, btn) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#171614"><h2 style="margin:0 0 12px">${esc(title)}</h2>${body}<p style="margin:20px 0"><a href="${esc(site)}" style="background:#524639;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(btn)}</a></p><p style="color:#777;font-size:12px">Sent automatically by the Lab Hours Log.</p></div>`;
/** rows: [{name, n, hours}] of students with entries waiting for approval */
export function adminEmail(rows, cyc, site) {
  const total = r2(rows.reduce((a, r) => a + r.hours, 0));
  if (!rows.length) return { subject: `Lab hours: nothing waiting (cycle ending ${cyc.endLabel})`, html: wrap("Nothing waiting for approval", "<p>Every logged entry is already approved.</p>", site, "Open the log") };
  const tr = rows.map((r) => `<tr><td style="padding:6px 12px 6px 0">${esc(r.name)}</td><td style="padding:6px 12px;text-align:right">${r.n}</td><td style="padding:6px 0 6px 12px;text-align:right"><b>${r2(r.hours)} h</b></td></tr>`).join("");
  return { subject: `Lab hours ready to approve: ${rows.length} student${rows.length > 1 ? "s" : ""}, ${total} h (cycle ending ${cyc.endLabel})`,
    html: wrap("Hours are ready for your approval", `<p>These entries are waiting. On the Dashboard, each student has one button: <b>Approve all waiting</b>.</p><table style="border-collapse:collapse"><tr style="color:#777;font-size:12px"><td>Student</td><td style="text-align:right;padding:0 12px">Entries</td><td style="text-align:right">Hours</td></tr>${tr}</table>`, site, "Review and approve") };
}
export function studentEmail(name, stat, cyc, site) {
  const ret = stat.returned ? `<p style="color:#9a3a2a"><b>${stat.returned} entr${stat.returned > 1 ? "ies were" : "y was"} returned to you.</b> Please fix and resubmit.</p>` : "";
  return { subject: `Please update your lab hours by ${cyc.endLabel}`,
    html: wrap(`Hi ${name}, time to update your lab hours`, `<p>The hours cycle ends on <b>${esc(cyc.endLabel)}</b>. So far this cycle you have logged <b>${r2(stat.hours)} h</b> in ${stat.n} entr${stat.n === 1 ? "y" : "ies"}.</p>${ret}<p>Please add any missing days before then so your hours can be approved.</p>`, site, "Open the log") };
}
