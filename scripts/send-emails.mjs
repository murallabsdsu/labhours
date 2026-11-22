// Usage: node scripts/send-emails.mjs students|admin   (set DRY_RUN=1 to print instead of sending)
import admin from "firebase-admin";
import nodemailer from "nodemailer";
import { cycleRange, hoursOf, adminEmail, studentEmail, r2 } from "./lib.mjs";

const mode = process.argv[2];
if (!["students", "admin"].includes(mode)) { console.error("Mode must be students or admin"); process.exit(1); }
const SITE = process.env.SITE_URL || "https://murallabsdsu.github.io/labhours/";
const DRY = process.env.DRY_RUN === "1";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const mail = DRY ? null : nodemailer.createTransport({ host: process.env.SMTP_HOST || "smtp-relay.brevo.com", port: Number(process.env.SMTP_PORT || 587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
const send = async (to, m) => {
  if (DRY) { console.log("DRY RUN to", to, "|", m.subject); return; }
  await mail.sendMail({ from: `Lab Hours Log <${process.env.MAIL_FROM}>`, to, subject: m.subject, html: m.html });
  console.log("sent to", to);
};
const cyc = cycleRange(new Date());
const usersSnap = await db.collection("users").get();
const users = {}; usersSnap.forEach((d) => { const x = d.data(); if (x.approved === true && x.name) users[d.id] = { name: x.name, email: x.email }; });
const entries = (await db.collection("entries").get()).docs.map((d) => d.data());

if (mode === "admin") {
  const byUid = {};
  entries.forEach((e) => { if (e.status !== "pending" || !users[e.uid]) return; const h = hoursOf(e); if (!h) return; const o = byUid[e.uid] || (byUid[e.uid] = { name: users[e.uid].name, n: 0, hours: 0 }); o.n++; o.hours += h; });
  const rows = Object.values(byUid).sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ ...r, hours: r2(r.hours) }));
  const m = adminEmail(rows, cyc, SITE);
  const admins = await db.collection("admins").get();
  for (const a of admins.docs) { try { const u = await admin.auth().getUser(a.id); if (u.email) await send(u.email, m); } catch (e) { console.error("admin", a.id, e.message); } }
} else {
  for (const [uid, u] of Object.entries(users)) {
    if (!u.email) continue;
    const mine = entries.filter((e) => e.uid === uid && e.date >= cyc.start && e.date <= cyc.end);
    const stat = { n: mine.length, hours: mine.reduce((a, e) => a + hoursOf(e), 0), returned: mine.filter((e) => e.status === "returned").length };
    try { await send(u.email, studentEmail(u.name, stat, cyc, SITE)); } catch (e) { console.error("student", u.email, e.message); }
  }
}
