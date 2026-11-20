import * as F from "./fb.js?v=5";
const { auth, db } = F;

const DEF_LOCS = ["Lab", "Greenhouse", "Field", "Computer or office", "Other"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseD = (s) => { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
let todayS = fmtDate(new Date());
const r2 = (n) => Math.round(n * 100) / 100;
const fh = (n) => String(r2(n));
const toMin = (t) => { const p = t.split(":").map(Number); return p[0] * 60 + p[1]; };
const fmtT = (t) => { const p = t.split(":").map(Number), h = p[0] % 12 || 12; return h + ":" + pad(p[1]) + " " + (p[0] < 12 ? "AM" : "PM"); };
const shortDate = (s) => parseD(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const longDate = (s) => parseD(s).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => { const p = ym.split("-").map(Number); return new Date(p[0], p[1] - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
const shiftMonth = (ym, n) => { const p = ym.split("-").map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); };
const dayDiff = (a, b) => Math.round((parseD(a) - parseD(b)) / 86400000);
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{0,39}$/;

let me = null, isAdmin = false, profile = null, view = "dash", month = todayS.slice(0, 7);
let locations = DEF_LOCS.slice(), entries = [], users = {}, unsubs = [];
let busy = false, editingId = null, selLoc = "", armed = null, armTimer = null;
let fStudent = "all", fStatus = "all", returningId = null, returnNote = "", addOpen = false, addErr = "";
let addForm = { uid: "", date: "", start: "", end: "", loc: "", place: "", task: "", approve: true };
let authMode = "in", autoMade = false;

/* ---------- helpers ---------- */
let toastT = null;
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400); }
function banner(m) { const b = $("banner"); if (m) { b.textContent = m; b.hidden = false; } else b.hidden = true; }
function errMsg(e) {
  const c = e && e.code || "";
  if (c.includes("permission-denied")) return "Not allowed. Your account may not be approved yet, or this entry is already approved.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("email-already-in-use")) return "That email already has an account. Sign in instead.";
  if (c.includes("weak-password")) return "Use a password with at least 8 characters.";
  if (c.includes("invalid-email")) return "That email address is not valid.";
  if (c.includes("too-many-requests")) return "Too many tries. Wait a minute and try again.";
  if (c.includes("unavailable") || c.includes("network")) return "No connection. Check your internet and try again.";
  return "Something went wrong. Try again.";
}
function clearSubs() { unsubs.forEach((u) => { try { u(); } catch (e) {} }); unsubs = []; }
function refreshToday() { const t = fmtDate(new Date()); if (t !== todayS) { todayS = t; render(); } }
window.addEventListener("focus", refreshToday);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshToday(); });

/* ---------- entries ---------- */
function norm(id, d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || "") || !/^\d{2}:\d{2}$/.test(d.start || "") || !/^\d{2}:\d{2}$/.test(d.end || "")) return null;
  const mins = toMin(d.end) - toMin(d.start); if (!(mins > 0 && mins <= 720)) return null;
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  return { id, uid: String(d.uid || ""), date: d.date, start: d.start, end: d.end, hours: r2(mins / 60), loc: String(d.loc || "").slice(0, 40), place: String(d.place || "").slice(0, 80),
    task: String(d.task || "").slice(0, 600), status: ["approved", "returned"].includes(d.status) ? d.status : "pending",
    note: String(d.note || "").slice(0, 300), approvedHours: Number(d.approvedHours) || 0, createdAt: ms(d.createdAt), by: d.addedBy === "owner" ? "owner" : "" };
}
const nameOf = (uid) => (users[uid] && users[uid].name) || "";
const rows = () => entries.map((e) => norm(e.id, e.data)).filter(Boolean);
const apprH = (r) => (r.status === "approved" ? r.hours : 0);
const pendH = (r) => (r.status === "approved" ? 0 : r.hours);
const isLate = (r) => r.by !== "owner" && r.createdAt && dayDiff(fmtDate(new Date(r.createdAt)), r.date) > 1;
const whereOf = (r) => ((r.loc || "") + (r.loc && r.place ? ": " : "") + (r.place || "")) || "Not given";
const pill = (r) => r.status === "approved" ? '<span class="pill ok">Approved</span>' : r.status === "returned" ? '<span class="pill bad">Returned</span>' : '<span class="pill warn">Waiting for approval</span>';
const byPill = (r) => (r.by === "owner" ? ' <span class="pill soft">Added by supervisor</span>' : "");
const approvedStudents = () => Object.keys(users).filter((u) => users[u].approved && users[u].name).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
const CV = (uid) => { const i = approvedStudents().indexOf(uid); return "var(--s" + (((i < 0 ? 0 : i) % 8) + 1) + ")"; };

/* ---------- auth screen ---------- */
function renderAuth() {
  $("tabs").hidden = true; $("who").hidden = true;
  const up = authMode === "up";
  $("main").innerHTML = `<form class="card narrow" id="auth-f" novalidate><h2>${up ? "Create your account" : "Sign in"}</h2>
    ${up ? '<label>Your full name<input id="au-name" maxlength="40" autocomplete="name"></label>' : ""}
    <label>Email<input id="au-email" type="email" autocomplete="email"></label>
    <label>Password<input id="au-pass" type="password" autocomplete="${up ? "new-password" : "current-password"}"><small>${up ? "At least 8 characters." : ""}</small></label>
    <div class="err" id="au-err" role="alert"></div>
    <button class="btn primary" type="submit">${up ? "Create account" : "Sign in"}</button>
    <div class="ctrl"><button class="link" type="button" id="au-switch">${up ? "I already have an account" : "First time? Create an account"}</button>${up ? "" : '<button class="link" type="button" id="au-reset">Forgot password</button>'}</div>
    ${up ? '<p class="muted">After you sign up, the lab supervisor must approve your account before you can log hours.</p>' : ""}</form>`;
  $("au-switch").onclick = () => { authMode = up ? "in" : "up"; renderAuth(); };
  if ($("au-reset")) $("au-reset").onclick = async () => {
    const em = $("au-email").value.trim(); if (!em) { $("au-err").textContent = "Type your email first."; return; }
    try { await F.sendPasswordResetEmail(auth, em); } catch (e) {} toast("If that email has an account, a reset link was sent.");
  };
  $("auth-f").onsubmit = async (ev) => {
    ev.preventDefault(); if (busy) return;
    const em = $("au-email").value.trim(), pw = $("au-pass").value, err = $("au-err");
    let nm = ""; if (up) { nm = $("au-name").value.trim().replace(/\s+/g, " "); if (!NAME_RE.test(nm)) { err.textContent = "Enter your name using letters only."; return; } }
    if (!em || pw.length < (up ? 8 : 1)) { err.textContent = up ? "Enter your email and a password of 8 or more characters." : "Enter your email and password."; return; }
    busy = true; err.textContent = "";
    try {
      if (up) {
        const cred = await F.createUserWithEmailAndPassword(auth, em, pw);
        try { await F.updateProfile(cred.user, { displayName: nm }); } catch (e2) {}
        try { await F.sendEmailVerification(cred.user); } catch (e2) {}
      } else await F.signInWithEmailAndPassword(auth, em, pw);
    } catch (e) { err.textContent = errMsg(e); }
    busy = false;
  };
}

/* ---------- session ---------- */
F.onAuthStateChanged(auth, async (u) => {
  clearSubs(); me = u; isAdmin = false; profile = null; entries = []; users = {}; banner("");
  if (!u) { renderAuth(); return; }
  if (!u.emailVerified) { renderVerify(u); return; }
  startSession(u);
});
function renderVerify(u) {
  $("tabs").hidden = true; $("who").hidden = false;
  $("who").innerHTML = `<span>${esc(u.email)}</span><button class="btn sm" id="so">Sign out</button>`; $("so").onclick = () => F.signOut(auth);
  $("main").innerHTML = `<div class="card narrow"><h2>Verify your email</h2><p class="muted">We sent a link to <b>${esc(u.email)}</b>. Open it, then come back here and click the button below. Check spam if you don't see it. Wrong email? Sign out and create the account again.</p>
   <div class="err" id="vf-e" role="alert"></div><button class="btn primary" id="vf-go">I verified my email</button><button class="btn" id="vf-re">Send the email again</button></div>`;
  $("vf-go").onclick = async () => { try { await u.reload(); if (auth.currentUser && auth.currentUser.emailVerified) { await auth.currentUser.getIdToken(true); me = auth.currentUser; startSession(me); } else $("vf-e").textContent = "Not verified yet. Open the link in the email first."; } catch (e) { $("vf-e").textContent = errMsg(e); } };
  $("vf-re").onclick = async () => { try { await F.sendEmailVerification(u); toast("Verification email sent"); } catch (e) { $("vf-e").textContent = errMsg(e); } };
}
async function startSession(u) {
  clearSubs(); isAdmin = false; profile = null; entries = []; users = {};
  $("main").innerHTML = '<p class="empty">Loading…</p>';
  try { const a = await F.getDoc(F.doc(db, "admins", u.uid)); isAdmin = a.exists(); } catch (e) { isAdmin = false; }
  unsubs.push(F.onSnapshot(F.doc(db, "settings", "main"), (s) => {
    const d = s.exists() ? s.data() : null;
    if (d && Array.isArray(d.locations)) { const l = d.locations.filter((x) => typeof x === "string" && x.length >= 2 && x.length <= 40).slice(0, 12); if (l.length) locations = l; }
    render();
  }, () => {}));
  $("who").hidden = false;
  $("who").innerHTML = `<span>${esc(u.email)}</span><button class="btn sm" id="so">Sign out</button>`;
  $("so").onclick = () => F.signOut(auth);
  if (isAdmin) {
    view = "dash";
    unsubs.push(F.onSnapshot(F.collection(db, "users"), (s) => { users = {}; s.docs.forEach((d) => { const x = d.data(); users[d.id] = { email: x.email || "", requested: x.requestedName || "", name: x.name || "", approved: x.approved === true }; }); render(); }, onErr));
    unsubs.push(F.onSnapshot(F.collection(db, "entries"), (s) => { entries = s.docs.map((d) => ({ id: d.id, data: d.data() })); render(); }, onErr));
  } else {
    unsubs.push(F.onSnapshot(F.doc(db, "users", u.uid), (s) => {
      if (!s.exists()) { profile = { missing: true }; const dn = (u.displayName || "").trim(); if (NAME_RE.test(dn) && !autoMade) { autoMade = true; F.setDoc(F.doc(db, "users", u.uid), { email: u.email || "", requestedName: dn, approved: false, createdAt: F.serverTimestamp() }).catch(() => { autoMade = false; }); } } else { const x = s.data(); profile = { approved: x.approved === true, name: x.name || "", requested: x.requestedName || "" }; if (profile.approved) users[u.uid] = { name: profile.name, approved: true }; }
      render();
    }, onErr));
    unsubs.push(F.onSnapshot(F.query(F.collection(db, "entries"), F.where("uid", "==", u.uid)), (s) => { entries = s.docs.map((d) => ({ id: d.id, data: d.data() })); render(); }, onErr));
  }
}
function onErr(e) { banner(e && e.code === "permission-denied" ? "You don't have access to this data." : "Could not load the log. Reload the page."); }

function render() {
  if (!me) return;
  const tabs = $("tabs");
  if (isAdmin) {
    tabs.hidden = false;
    const t = [["dash", "Dashboard"], ["acc", "Accounts"], ["set", "Settings"]];
    tabs.innerHTML = t.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${view === k}">${l}${k === "acc" && pendingUsers().length ? " (" + pendingUsers().length + ")" : ""}</button>`).join("");
    tabs.querySelectorAll("button").forEach((b) => (b.onclick = () => { view = b.dataset.v; render(); }));
    const ae = document.activeElement; if (ae && ae.closest && ae.closest("#main") && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    if (view === "dash") renderDash(); else if (view === "acc") renderAccounts(); else renderSettings();
  } else {
    tabs.hidden = true;
    if (!profile) return;
    if (profile.missing) { renderMissing(); return; }
    if (!profile.approved) { $("main").innerHTML = `<div class="card narrow"><h2>Waiting for the supervisor</h2><p class="muted">Your account (${esc(me.email)}) was created. When the lab supervisor approves it, this page will show your log form. You can close this page and come back later.</p></div>`; return; }
    const ae = document.activeElement; if (ae && ae.closest && ae.closest("#log-wrap") && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) { renderMineOnly(); return; }
    renderStudent();
  }
}
function renderMissing() {
  $("main").innerHTML = `<div class="card narrow"><h2>Finish setting up</h2><p class="muted">Your account has no profile yet.</p><input id="mn" placeholder="Your full name" maxlength="40"><div class="err" id="mn-e"></div><button class="btn primary" id="mn-b">Send to supervisor</button></div>`;
  $("mn-b").onclick = async () => { const nm = $("mn").value.trim().replace(/\s+/g, " "); if (!NAME_RE.test(nm)) { $("mn-e").textContent = "Enter your name using letters only."; return; }
    try { await F.setDoc(F.doc(db, "users", me.uid), { email: me.email || "", requestedName: nm, approved: false, createdAt: F.serverTimestamp() }); } catch (e) { $("mn-e").textContent = errMsg(e); } };
}

/* ---------- student view ---------- */
function renderStudent() {
  $("main").innerHTML = `<div class="log-grid" id="log-wrap"><form id="f" class="card" novalidate>
    <h2 id="f-title">${editingId ? "Edit entry" : "Add your work"}</h2>
    <div class="row2"><label>Your name<input value="${esc(profile.name)}" disabled></label><label>Date worked<input id="f-date" type="date" max="${todayS}" value="${todayS}"></label></div>
    <div class="row3"><label>Start<input id="f-start" type="time"></label><label>End<input id="f-end" type="time"></label><div class="lab"><small>Hours</small><div class="hours-out" id="f-hours">0 h</div></div></div>
    <div class="lab" role="radiogroup"><span>Where did you work?</span><div class="chips" id="f-loc"></div></div>
    <label>Which room, field or plot?<small>Example: Greenhouse 2 bench A, Field 3 rows 1 to 40, Lab room 214.</small><input id="f-place" maxlength="80" autocomplete="off"></label>
    <label>What work did you do?<textarea id="f-task" maxlength="600"></textarea></label>
    <div class="err" id="f-err" role="alert"></div>
    <div class="btnrow"><button class="btn primary" id="f-submit" type="submit">${editingId ? "Save changes" : "Save entry"}</button><button class="btn" id="f-cancel" type="button" ${editingId ? "" : "hidden"}>Cancel</button></div></form>
    <div class="card" id="mine"></div></div>`;
  fillLocs(); renderMineOnly();
  const calc = () => { const s = $("f-start").value, e = $("f-end").value; const m = s && e ? toMin(e) - toMin(s) : 0; $("f-hours").textContent = m > 0 ? fh(m / 60) + " h" : "0 h"; };
  $("f-start").oninput = calc; $("f-end").oninput = calc;
  $("f-cancel").onclick = () => { editingId = null; selLoc = ""; renderStudent(); };
  $("f").onsubmit = submitStudent;
  $("f-loc").onclick = (ev) => { const b = ev.target.closest("[data-loc]"); if (!b) return; selLoc = b.dataset.loc; fillLocs(); };
  if (editingId) { const r = rows().find((x) => x.id === editingId); if (r) { $("f-date").value = r.date; $("f-start").value = r.start; $("f-end").value = r.end; selLoc = r.loc; fillLocs(); $("f-place").value = r.place; $("f-task").value = r.task; calc(); } }
}
function fillLocs() {
  const box = $("f-loc"); if (!box) return; if (!locations.includes(selLoc) && selLoc) locations = locations.concat([selLoc]);
  box.innerHTML = locations.map((l) => `<button type="button" class="chip" role="radio" aria-checked="${l === selLoc}" data-loc="${esc(l)}">${esc(l)}</button>`).join("");
  const p = $("f-place"); if (p) p.placeholder = /field|other/i.test(selLoc) ? "Required for this place" : "Optional";
}
const needsPlace = (l) => /field|other/i.test(l);
function overlapMsg(uid, date, start, end, skipId) {
  for (const l of rows()) if (l.uid === uid && l.id !== skipId && l.date === date && toMin(start) < toMin(l.end) && toMin(l.start) < toMin(end)) return "This overlaps an entry already logged (" + fmtT(l.start) + " to " + fmtT(l.end) + ").";
  return "";
}
async function submitStudent(ev) {
  ev.preventDefault(); if (busy) return; refreshToday();
  const v = { date: $("f-date").value, start: $("f-start").value, end: $("f-end").value, loc: selLoc, place: $("f-place").value.trim(), task: $("f-task").value.trim() };
  const err = $("f-err"); let m = v.start && v.end ? toMin(v.end) - toMin(v.start) : 0;
  const cur = editingId ? rows().find((x) => x.id === editingId) : null;
  err.textContent = "";
  if (editingId && (!cur || cur.status === "approved")) { err.textContent = "This entry was approved, so it can't be changed now."; editingId = null; return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) err.textContent = "Pick the date you worked.";
  else if (v.date > todayS) err.textContent = "The date can't be in the future.";
  else if (dayDiff(todayS, v.date) > 31) err.textContent = "Entries older than 31 days can't be added. Ask the lab supervisor.";
  else if (!v.start || !v.end) err.textContent = "Enter your start and end time.";
  else if (m <= 0) err.textContent = "End time must be after start time.";
  else if (m > 720) err.textContent = "One entry can't be longer than 12 hours. Split it into two.";
  else if (!v.loc) err.textContent = "Choose where you worked.";
  else if (needsPlace(v.loc) && v.place.length < 2) err.textContent = "Say which field or place you worked in.";
  else if (v.task.length < 2) err.textContent = "Say what work you did.";
  else err.textContent = overlapMsg(me.uid, v.date, v.start, v.end, editingId);
  if (err.textContent) return;
  busy = true; $("f-submit").disabled = true;
  const body = { uid: me.uid, date: v.date, start: v.start, end: v.end, hours: r2(m / 60), loc: v.loc, place: v.place, task: v.task, status: "pending" };
  try {
    if (editingId) { body.updatedAt = F.serverTimestamp(); await F.updateDoc(F.doc(db, "entries", editingId), body); toast("Changes saved. It goes back to the supervisor for approval."); }
    else { body.createdAt = F.serverTimestamp(); await F.addDoc(F.collection(db, "entries"), body); toast("Saved. It counts once it is approved."); }
    editingId = null; selLoc = ""; renderStudent();
  } catch (e) { err.textContent = errMsg(e); $("f-submit").disabled = false; }
  busy = false;
}
function renderMineOnly() {
  const box = $("mine"); if (!box) return;
  const all = rows().filter((r) => r.uid === me.uid), wk = mondayOf(todayS), ym = todayS.slice(0, 7);
  let td = 0, w = 0, mo = 0, mA = 0; all.forEach((r) => { if (r.date === todayS) td += r.hours; if (mondayOf(r.date) === wk) w += r.hours; if (r.date.slice(0, 7) === ym) { mo += r.hours; mA += apprH(r); } });
  const list = all.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).slice(0, 25);
  let h = `<div class="mhead"><h2>${esc(profile.name)}’s entries</h2><div class="stats"><span>Today <b class="mono">${fh(td)} h</b></span><span>This week <b class="mono">${fh(w)} h</b></span><span>${MON[+ym.slice(5) - 1]} <b class="mono">${fh(mo)} h</b> logged, <b class="mono">${fh(mA)} h</b> approved</span></div></div>`;
  if (!list.length) h += '<p class="empty">No entries yet. Add your first one on the left.</p>';
  else { let cur = ""; const tot = {}; list.forEach((r) => (tot[r.date] = (tot[r.date] || 0) + r.hours));
    list.forEach((r) => { if (r.date !== cur) { if (cur) h += "</div>"; cur = r.date; h += `<div class="day"><div class="dayhead"><span>${esc(longDate(r.date))}</span><span class="mono">${fh(tot[r.date])} h</span></div>`; }
      h += `<div class="entry"><div class="meta"><span class="mono muted">${esc(fmtT(r.start))} to ${esc(fmtT(r.end))}</span><span class="mono"><b>${fh(r.hours)} h</b></span>${pill(r)}${byPill(r)}${isLate(r) ? '<span class="pill bad">Late</span>' : ""}</div>
      <div class="acts">${r.status !== "approved" ? `<button class="btn sm" data-edit="${esc(r.id)}">Edit</button><button class="btn sm danger" data-del="${esc(r.id)}">Delete</button>` : ""}</div>
      ${r.note && r.status === "returned" ? `<div class="note">Returned: ${esc(r.note)}</div>` : ""}<div class="out"><b>Where:</b> ${esc(whereOf(r))}</div><div class="what">${esc(r.task)}</div></div>`; });
    h += "</div>"; }
  box.innerHTML = h;
  box.onclick = async (ev) => {
    const e = ev.target.closest("[data-edit]"); if (e) { editingId = e.dataset.edit; renderStudent(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const b = ev.target.closest("[data-del]"); if (!b) return; const id = b.dataset.del;
    if (armed !== id) { armed = id; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; renderMineOnly(); }, 4000); b.textContent = "Tap again to delete"; return; }
    armed = null; clearTimeout(armTimer);
    try { await F.deleteDoc(F.doc(db, "entries", id)); if (editingId === id) editingId = null; toast("Entry deleted"); } catch (er) { toast(errMsg(er)); }
  };
}
function mondayOf(s) { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtDate(d); }

/* ---------- admin ---------- */
const pendingUsers = () => Object.keys(users).filter((u) => !users[u].approved);
function renderAccounts() {
  const pend = pendingUsers(), appr = Object.keys(users).filter((u) => users[u].approved);
  let h = `<div class="card"><h3>Waiting for approval</h3>${pend.length ? pend.map((u) => `<div class="srow"><span><b>${esc(users[u].requested || "(no name)")}</b> <span class="muted">${esc(users[u].email)}</span></span><span class="ctrl"><input data-nm="${esc(u)}" value="${esc(users[u].requested)}" maxlength="40" aria-label="Name to use"><button class="btn sm" data-approve-user="${esc(u)}">Approve</button></span></div>`).join("") : '<p class="empty">No one is waiting.</p>'}
  <p class="tfoot-note">Check the email before you approve. The name you type here is the name used for all of that student's hours.</p></div>
  <div class="card"><h3>Approved students</h3>${appr.length ? appr.map((u) => `<div class="srow"><span><b>${esc(users[u].name)}</b> <span class="muted">${esc(users[u].email)}</span></span><button class="btn sm danger" data-revoke="${esc(u)}">Remove access</button></div>`).join("") : '<p class="empty">None yet.</p>'}
  <p class="tfoot-note">Removing access stops the student from logging more hours. Their past entries stay.</p></div>`;
  $("main").innerHTML = h;
  $("main").onclick = async (ev) => {
    const a = ev.target.closest("[data-approve-user]"), r = ev.target.closest("[data-revoke]");
    try {
      if (a) { const u = a.dataset.approveUser, inp = $("main").querySelector(`[data-nm="${u}"]`), nm = inp.value.trim().replace(/\s+/g, " ");
        if (!NAME_RE.test(nm)) { toast("Use letters only for the name."); return; }
        if (approvedStudents().some((x) => nameOf(x).toLowerCase() === nm.toLowerCase())) { toast("That name is already used. Add a last initial."); return; }
        await F.updateDoc(F.doc(db, "users", u), { approved: true, name: nm }); toast("Approved"); }
      else if (r) { await F.updateDoc(F.doc(db, "users", r.dataset.revoke), { approved: false }); toast("Access removed"); }
    } catch (e) { toast(errMsg(e)); }
  };
}
function renderSettings() {
  $("main").innerHTML = `<div class="card"><h3>Places to choose from</h3>${locations.map((l) => `<div class="srow"><span>${esc(l)}</span><button class="btn sm danger" data-rm="${esc(l)}">Remove</button></div>`).join("")}
  <div class="ctrl" style="margin-top:12px"><input id="new-loc" maxlength="40" placeholder="New place, for example Sorghum field" style="max-width:320px"><button class="btn" data-add-loc>Add</button></div>
  <p class="tfoot-note">Places with the words field or other ask the student for the exact spot.</p></div>
  <div class="card"><h3>Backup</h3><button class="btn primary" data-backup>Download everything (CSV)</button><p class="tfoot-note">Download once a month and keep it with your lab records.</p></div>`;
  $("main").onclick = async (ev) => {
    try {
      if (ev.target.closest("[data-backup]")) { const rs = rows(); downloadCsv("lab-hours-backup-" + todayS + ".csv", buildCsv(rs, "Approved hours (all time)", aggregate(rs), approvedStudents())); return; }
      const rm = ev.target.closest("[data-rm]"); if (rm) { if (locations.length <= 1) { toast("Keep at least one place."); return; } await F.setDoc(F.doc(db, "settings", "main"), { locations: locations.filter((x) => x !== rm.dataset.rm) }); toast("Saved"); return; }
      if (ev.target.closest("[data-add-loc]")) { const v = $("new-loc").value.trim().replace(/\s+/g, " ");
        if (v.length < 2 || v.length > 40) { toast("Place names need 2 to 40 characters."); return; }
        if (locations.some((x) => x.toLowerCase() === v.toLowerCase())) { toast("Already in the list."); return; }
        if (locations.length >= 12) { toast("The list is full."); return; }
        await F.setDoc(F.doc(db, "settings", "main"), { locations: locations.concat([v]) }); toast("Saved"); }
    } catch (e) { toast(errMsg(e)); }
  };
}
function aggregate(rs) {
  const A = {}; approvedStudents().forEach((u) => (A[u] = { appr: 0, pend: 0, n: 0, last: "" }));
  rs.forEach((r) => { const o = A[r.uid]; if (!o) return; o.appr += apprH(r); o.pend += pendH(r); o.n++; if (r.date > o.last) o.last = r.date; });
  return A;
}
function csvCell(v) { let s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function buildCsv(rs, label, A, studs) {
  const L = [["Student", "Date", "Start", "End", "Hours logged", "Hours approved", "Status", "Where", "Work done", "Email"].join(",")];
  rs.slice().sort((a, b) => nameOf(a.uid).localeCompare(nameOf(b.uid)) || (a.date + a.start).localeCompare(b.date + b.start)).forEach((r) =>
    L.push([csvCell(nameOf(r.uid)), r.date, r.start, r.end, r.hours, apprH(r), r.status, csvCell(whereOf(r)), csvCell(r.task), csvCell((users[r.uid] || {}).email)].join(",")));
  L.push(""); L.push("Student," + label); studs.forEach((u) => L.push(csvCell(nameOf(u)) + "," + r2((A[u] || { appr: 0 }).appr)));
  return L.join("\r\n");
}
function downloadCsv(name, data) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "text/csv" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

function renderDash() {
  const all = rows(), mrows = all.filter((r) => r.date.slice(0, 7) === month), A = aggregate(mrows), studs = approvedStudents();
  const wait = all.filter((r) => r.status === "pending").length, ret = all.filter((r) => r.status === "returned").length, np = pendingUsers().length;
  let h = `<div class="ctrl"><div class="monthnav"><button class="btn" id="m-prev" aria-label="Previous month">‹</button><span class="mlabel">${esc(monthLabel(month))}</span><button class="btn" id="m-next" aria-label="Next month">›</button></div><span class="grow"></span>
   <label style="flex-direction:row;align-items:center;gap:6px">Student<select id="d-student"><option value="all">All students</option>${studs.map((u) => `<option value="${esc(u)}"${fStudent === u ? " selected" : ""}>${esc(nameOf(u))}</option>`).join("")}</select></label>
   <label style="flex-direction:row;align-items:center;gap:6px">Status<select id="d-status">${[["all", "All"], ["pending", "Waiting for approval"], ["returned", "Returned"], ["approved", "Approved"]].map(([k, l]) => `<option value="${k}"${fStatus === k ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>`;
  if (np) h += `<div class="strip attn"><b>${np} account${np > 1 ? "s" : ""} waiting for approval</b><button class="btn" data-go="acc">Open Accounts</button></div>`;
  h += wait || ret ? `<div class="strip"><div><b>${wait} waiting for your approval</b>${ret ? ` <span class="muted">· ${ret} returned to students</span>` : ""}<div class="muted" style="font-size:12.5px">Across all months. Use the Status filter to see them.</div></div></div>` : '<div class="strip clear"><b>Nothing waiting. Every entry has been approved.</b></div>';
  let totA = 0, totP = 0; studs.forEach((u) => { totA += A[u].appr; totP += A[u].pend; });
  h += `<div class="tiles">${studs.map((u) => { const last = A[u].last || all.filter((r) => r.uid === u).map((r) => r.date).sort().pop() || ""; const ago = last ? dayDiff(todayS, last) : null;
    return `<div class="tile" style="--c:${CV(u)}"><div class="who2"><i class="dot"></i>${esc(nameOf(u))}</div><div class="big">${fh(A[u].appr)}<small>h approved</small></div><div class="sub">${A[u].pend > 0 ? `<span class="pill warn">${fh(A[u].pend)} h waiting</span>` : "<span>Nothing waiting</span>"}<span>${A[u].n} entries</span></div><div class="sub">${last ? "Last log " + esc(shortDate(last)) + (ago === 0 ? " (today)" : " (" + ago + " d ago)") : "No entries yet"}${ago !== null && ago >= 3 ? ` <span class="pill warn">No log for ${ago} days</span>` : ""}</div></div>`; }).join("")}
   <div class="tile total"><div class="who2">All students</div><div class="big">${fh(totA)}<small>h approved</small></div><div class="sub"><span>${fh(totP)} h waiting</span></div></div></div>`;
  /* year table */
  const yr = month.slice(0, 4), curM = +month.slice(5) - 1, Y = {}; studs.forEach((u) => (Y[u] = Array(12).fill(0)));
  all.forEach((r) => { if (r.date.slice(0, 4) === yr && Y[r.uid]) Y[r.uid][+r.date.slice(5, 7) - 1] += apprH(r); });
  const colT = Array(12).fill(0);
  h += `<div class="card"><div class="tbar"><h3 style="margin:0">Approved hours in ${esc(yr)}</h3><div class="monthnav"><button class="btn sm" id="y-prev" aria-label="Previous year">‹</button><button class="btn sm" id="y-next" aria-label="Next year">›</button></div></div><div class="scroll"><table class="yt"><thead><tr><th>Student</th>${MON.map((m, i) => `<th class="${i === curM ? "cur" : ""}">${m}</th>`).join("")}<th>Total</th></tr></thead><tbody>
   ${studs.map((u) => { let t = 0; return `<tr><td><i class="dot" style="--c:${CV(u)}"></i> ${esc(nameOf(u))}</td>${Y[u].map((v, i) => { t += v; colT[i] += v; return `<td class="mono ${i === curM ? "cur" : ""}">${v ? fh(v) : ""}</td>`; }).join("")}<td class="mono"><b>${fh(t)}</b></td></tr>`; }).join("")}
   </tbody><tfoot><tr><td>All students</td>${colT.map((v, i) => `<td class="mono ${i === curM ? "cur" : ""}">${v ? fh(v) : ""}</td>`).join("")}<td class="mono">${fh(colT.reduce((a, b) => a + b, 0))}</td></tr></tfoot></table></div></div>`;
  /* entries */
  const dayTot = {}; mrows.forEach((r) => { const k = r.uid + "|" + r.date; dayTot[k] = (dayTot[k] || 0) + r.hours; });
  const fr = mrows.filter((r) => (fStudent === "all" || r.uid === fStudent) && (fStatus === "all" || r.status === fStatus)).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const todo = fr.filter((r) => r.status === "pending").length;
  h += `<div class="card"><div class="tbar"><h3 style="margin:0">Entries</h3><div class="ctrl"><button class="btn" data-act="add-open">${addOpen ? "Close add form" : "Add entry for a student"}</button>${todo ? `<button class="btn" data-act="approve-all">Approve all waiting (${todo})</button>` : ""}<button class="btn" data-act="csv">Download CSV</button></div></div>`;
  if (addOpen) h += addPanel(studs);
  h += fr.length ? `<div class="scroll"><table><thead><tr><th>Date</th><th>Student</th><th>Time</th><th class="n">Hours</th><th>Where</th><th>Work done</th><th>Status</th><th></th></tr></thead><tbody>${fr.map((r) => {
    const act = r.status === "approved" ? `<button class="btn sm" data-act="unapprove" data-id="${esc(r.id)}">Undo</button>` : `<div class="ctrl"><button class="btn sm" data-act="approve" data-id="${esc(r.id)}">Approve</button>${r.status === "returned" ? "" : `<button class="btn sm" data-act="return" data-id="${esc(r.id)}">Return</button>`}</div>`;
    let row = `<tr><td class="mono" style="white-space:nowrap">${esc(shortDate(r.date))}${isLate(r) ? ' <span class="pill bad">Late</span>' : ""}${dayTot[r.uid + "|" + r.date] > 10 ? ` <span class="pill warn">${fh(dayTot[r.uid + "|" + r.date])} h that day</span>` : ""}</td><td style="white-space:nowrap"><i class="dot" style="--c:${CV(r.uid)}"></i> ${esc(nameOf(r.uid))}</td><td class="mono muted" style="white-space:nowrap">${esc(fmtT(r.start))} to ${esc(fmtT(r.end))}</td><td class="n mono">${fh(r.hours)}</td><td class="what">${esc(whereOf(r))}</td><td class="what">${esc(r.task)}</td><td>${pill(r)}${byPill(r)}${r.note && r.status === "returned" ? `<div class="muted" style="font-size:12px;max-width:180px;overflow-wrap:anywhere">${esc(r.note)}</div>` : ""}</td><td>${act}</td></tr>`;
    if (returningId === r.id) row += `<tr class="sub"><td colspan="8"><div class="retin"><input id="ret-note" maxlength="300" value="${esc(returnNote)}" placeholder="What should the student fix?"><button class="btn sm" data-act="return-send" data-id="${esc(r.id)}">Send back</button><button class="btn sm" data-act="return-cancel">Cancel</button></div></td></tr>`;
    return row; }).join("")}</tbody></table></div>` : '<p class="empty">No entries match. Change the month or the filters above.</p>';
  h += `<p class="tfoot-note">Only approved hours count. Approved entries are locked: students cannot edit or delete them. Hours are always calculated from start and end times.</p></div>`;
  $("main").innerHTML = h;
  $("m-prev").onclick = () => { month = shiftMonth(month, -1); render(); }; $("m-next").onclick = () => { month = shiftMonth(month, 1); render(); };
  $("y-prev").onclick = () => { month = shiftMonth(month, -12); render(); }; $("y-next").onclick = () => { month = shiftMonth(month, 12); render(); };
  $("d-student").onchange = (e) => { fStudent = e.target.value; render(); }; $("d-status").onchange = (e) => { fStatus = e.target.value; render(); };
  $("main").oninput = (e) => { const id = e.target.id; if (id === "ret-note") returnNote = e.target.value; const m = { "a-uid": "uid", "a-date": "date", "a-start": "start", "a-end": "end", "a-loc": "loc", "a-place": "place", "a-task": "task" }; if (m[id]) addForm[m[id]] = e.target.value; else if (id === "a-approve") addForm.approve = e.target.checked; };
  $("main").onchange = (e) => { if (e.target.id === "a-approve") addForm.approve = e.target.checked; };
  $("main").onclick = (ev) => dashClick(ev, fr);
}
function addPanel(studs) {
  if (!studs.length) return '<p class="empty">No approved student yet.</p>';
  const f = addForm; if (!f.uid || !studs.includes(f.uid)) f.uid = studs[0]; if (!f.date) f.date = todayS;
  return `<form class="card" id="add-panel" novalidate style="margin-bottom:12px"><h3 style="margin:0">Add an entry for a student</h3>
   <div class="row2"><label>Student<select id="a-uid">${studs.map((u) => `<option value="${esc(u)}"${u === f.uid ? " selected" : ""}>${esc(nameOf(u))}</option>`).join("")}</select></label><label>Date<input id="a-date" type="date" max="${todayS}" value="${esc(f.date)}"></label></div>
   <div class="row2"><label>Start<input id="a-start" type="time" value="${esc(f.start)}"></label><label>End<input id="a-end" type="time" value="${esc(f.end)}"></label></div>
   <div class="row2"><label>Where<select id="a-loc"><option value="">Choose…</option>${locations.map((l) => `<option${l === f.loc ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label>Room, field or plot<input id="a-place" maxlength="80" value="${esc(f.place)}"></label></div>
   <label>Work done<textarea id="a-task" maxlength="600">${esc(f.task)}</textarea></label>
   <label style="flex-direction:row;align-items:center;gap:8px"><input id="a-approve" type="checkbox"${f.approve ? " checked" : ""}> Approve it now</label>
   <div class="err" role="alert">${esc(addErr)}</div><div class="btnrow"><button class="btn primary" type="button" data-act="add-save">Save entry</button></div></form>`;
}
async function dashClick(ev, fr) {
  const g = ev.target.closest("[data-go]"); if (g) { view = g.dataset.go; render(); return; }
  const b = ev.target.closest("[data-act]"); if (!b) return; const act = b.dataset.act, id = b.dataset.id;
  const rs = rows(), find = () => rs.find((x) => x.id === id);
  try {
    if (act === "csv") { downloadCsv("lab-hours-" + month + ".csv", buildCsv(fr, "Approved hours in " + month, aggregate(rs.filter((r) => r.date.slice(0, 7) === month)), approvedStudents())); return; }
    if (act === "add-open") { addOpen = !addOpen; addErr = ""; if (document.activeElement) document.activeElement.blur(); render(); return; }
    if (act === "add-save") { await saveAdded(b); return; }
    if (act === "approve") { const r = find(); if (!r) return; b.disabled = true; await F.updateDoc(F.doc(db, "entries", id), { status: "approved", approvedHours: r.hours, approvedAt: F.serverTimestamp(), note: "" }); toast("Approved"); }
    else if (act === "unapprove") { b.disabled = true; await F.updateDoc(F.doc(db, "entries", id), { status: "pending", approvedHours: 0 }); toast("Approval removed"); }
    else if (act === "return") { returningId = id; returnNote = ""; render(); const i = $("ret-note"); if (i) i.focus(); }
    else if (act === "return-cancel") { returningId = null; returnNote = ""; if (document.activeElement) document.activeElement.blur(); render(); }
    else if (act === "return-send") { const n = returnNote.trim(); if (n.length < 3) { toast("Write a short note so the student knows what to fix."); return; }
      b.disabled = true; await F.updateDoc(F.doc(db, "entries", id), { status: "returned", note: n.slice(0, 300) }); returningId = null; returnNote = ""; if (document.activeElement) document.activeElement.blur(); toast("Sent back to the student"); render(); }
    else if (act === "approve-all") {
      if (armed !== "all") { armed = "all"; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; render(); }, 4000); b.textContent = "Tap again to approve all"; return; }
      armed = null; clearTimeout(armTimer); b.disabled = true; const todo = fr.filter((r) => r.status === "pending");
      for (const r of todo) await F.updateDoc(F.doc(db, "entries", r.id), { status: "approved", approvedHours: r.hours, approvedAt: F.serverTimestamp(), note: "" });
      toast("Approved " + todo.length + " entries");
    }
  } catch (e) { toast(errMsg(e)); render(); }
}
async function saveAdded(btn) {
  const f = addForm, m = f.start && f.end ? toMin(f.end) - toMin(f.start) : 0, place = f.place.trim(), task = f.task.trim(); addErr = "";
  if (!f.uid) addErr = "Choose a student."; else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) addErr = "Pick the date."; else if (f.date > todayS) addErr = "The date can't be in the future.";
  else if (!f.start || !f.end) addErr = "Enter start and end time."; else if (m <= 0) addErr = "End time must be after start time."; else if (m > 720) addErr = "One entry can't be longer than 12 hours.";
  else if (!f.loc) addErr = "Choose where it was done."; else if (needsPlace(f.loc) && place.length < 2) addErr = "Say which field or place."; else if (task.length < 2) addErr = "Say what work was done."; else addErr = overlapMsg(f.uid, f.date, f.start, f.end, null);
  if (addErr) { if (document.activeElement) document.activeElement.blur(); render(); return; }
  btn.disabled = true;
  const body = { uid: f.uid, date: f.date, start: f.start, end: f.end, hours: r2(m / 60), loc: f.loc, place, task, status: f.approve ? "approved" : "pending", createdAt: F.serverTimestamp(), addedBy: "owner" };
  if (f.approve) { body.approvedHours = r2(m / 60); body.approvedAt = F.serverTimestamp(); }
  try { await F.addDoc(F.collection(db, "entries"), body); toast(f.approve ? "Entry added and approved" : "Entry added, waiting for approval"); const u = f.uid; addForm = { uid: u, date: "", start: "", end: "", loc: "", place: "", task: "", approve: true }; addOpen = false; if (document.activeElement) document.activeElement.blur(); render(); }
  catch (e) { addErr = errMsg(e); btn.disabled = false; render(); }
}
