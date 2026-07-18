// LockIn renderer — vanilla JS. REST + 5s polling; live stats extrapolated client-side each second.
"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- settings ----------
const S = Object.assign({
  theme: "dark", accent: "violet", sfx: true, vol: 0.5, notif: false,
  goal: 180, lens: [25, 50, 90], breakLens: [5, 10, 15], offline: false, hideAct: false,
}, JSON.parse(localStorage.getItem("settings") || "{}"));
function saveS() { localStorage.setItem("settings", JSON.stringify(S)); applyTheme(); }
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  document.documentElement.dataset.accent = S.accent;
}
applyTheme();

// ---------- identity / server ----------
const cfg = {
  get server() { return localStorage.getItem("server") || ""; },
  set server(v) { localStorage.setItem("server", v.replace(/\/+$/, "")); },
  get userId() { return localStorage.getItem("userId"); },
  get secret() { return localStorage.getItem("secret"); },
  saveUser(u) { localStorage.setItem("userId", u.userId); localStorage.setItem("secret", u.secret); },
};

async function api(path, body) {
  const url = cfg.server + path + (body ? "" : `?userId=${cfg.userId}&secret=${cfg.secret}`);
  const res = await fetch(url, body ? {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, userId: cfg.userId, secret: cfg.secret }),
  } : undefined);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// ---------- sfx (WebAudio synth — no assets) ----------
let actx;
function tone(steps, type = "sine", vol = 1) {
  if (!S.sfx) return;
  try {
    actx = actx || new AudioContext();
    if (actx.state === "suspended") actx.resume();
    const v = 0.16 * S.vol * vol;
    steps.forEach(([freq, t, dur]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, actx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(v, actx.currentTime + t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + dur);
      o.start(actx.currentTime + t); o.stop(actx.currentTime + t + dur + 0.02);
    });
  } catch {}
}
const sfx = {
  click: () => tone([[1250, 0, 0.05]], "sine", 0.55),
  start: () => tone([[440, 0, 0.1], [660, 0.09, 0.14]]),
  pause: () => tone([[660, 0, 0.1], [440, 0.09, 0.14]]),
  complete: () => tone([[523, 0, 0.18], [659, 0.14, 0.18], [784, 0.28, 0.3]]),
  coin: () => tone([[988, 0, 0.07], [1319, 0.07, 0.16]], "triangle"),
  error: () => tone([[220, 0, 0.2]], "square", 0.4),
};
document.addEventListener("click", (e) => { if (e.target.closest(".btn,.mode,.tab,.range,.seg button,.icon-btn,.swatch,.profile-pill")) sfx.click(); });

function notify(title, body) {
  if (!S.notif) return;
  try { if (Notification.permission === "granted") new Notification(title, { body, silent: true }); } catch {}
}

// ---------- confetti (tiny canvas burst, no deps) ----------
function confetti() {
  const cv = $("#confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = [getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), "#2fd27e", "#ffc94d", "#4facfe", "#f5576c"];
  const parts = Array.from({ length: 110 }, () => ({
    x: cv.width / 2 + (Math.random() - 0.5) * 160, y: cv.height * 0.42,
    vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 5,
    w: 5 + Math.random() * 5, h: 8 + Math.random() * 6,
    c: colors[Math.floor(Math.random() * colors.length)],
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
  }));
  let frames = 0;
  (function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.42; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - frames / 90);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    if (++frames < 95) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

// ---------- helpers ----------
const fmtHM = (s) => { s = Math.floor(s); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 60)}m`; };
const fmtClock = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const av = (m, size = "") => `<span class="avatar av${(m.avatar || 0) % 12} ${size} ${m.frame ? "fr-" + esc(m.frame) : ""}">${m.avatarImg ? `<img src="${esc(m.avatarImg)}" alt="">` : esc((m.name || "?")[0].toUpperCase())}</span>`;
const flairChip = (m) => m.flair ? `<span class="flair-chip">${esc(m.flair)}</span>` : "";
// levels: xp = lifetime focused minutes; level n starts at 30·(n−1)² xp
const xpOf = (m) => Math.floor((m.totalSeconds || 0) / 60);
const levelOf = (m) => Math.floor(Math.sqrt(xpOf(m) / 30)) + 1;
const xpForLevel = (n) => 30 * (n - 1) * (n - 1);
function toast(msg, ms = 3400) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden", "out");
  clearTimeout(t._h); clearTimeout(t._h2);
  t._h = setTimeout(() => {
    t.classList.add("out");
    t._h2 = setTimeout(() => t.classList.add("hidden"), 200);
  }, ms);
}
// count-up tween for integer displays (coins etc.)
function countUp(el, to) {
  const from = Number(String(el.textContent).replace(/[^\d]/g, "")) || 0;
  if (from === to) { el.textContent = to.toLocaleString(); return; }
  const t0 = performance.now(), dur = Math.min(700, 200 + Math.abs(to - from) * 8);
  let done = false;
  (function step(t) {
    if (done) return;
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * e).toLocaleString();
    if (p < 1) requestAnimationFrame(step); else done = true;
  })(t0);
  // rAF is throttled/frozen in background windows — guarantee the final value lands
  setTimeout(() => { if (!done) { done = true; el.textContent = to.toLocaleString(); } }, dur + 260);
}
// focus sessions completed today (client-side, for the dot row)
function sessionDots(add) {
  const d = new Date().toDateString();
  let rec = JSON.parse(localStorage.getItem("sessions") || "{}");
  if (rec.d !== d) rec = { d, n: 0 };
  if (add) { rec.n++; localStorage.setItem("sessions", JSON.stringify(rec)); }
  $("#session-dots").innerHTML = "<i></i>".repeat(Math.min(rec.n, 12));
}

// ---------- modal ----------
function modal(title, bodyHtml, onOk, okText = "Save") {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  const ok = $("#modal-ok");
  ok.textContent = okText;
  $("#modal").classList.remove("hidden");
  ok.onclick = async () => {
    ok.classList.add("loading"); ok.disabled = true;
    try { if (await onOk() !== false) closeModal(); }
    finally { ok.classList.remove("loading"); ok.disabled = false; }
  };
  $("#modal-cancel").onclick = $("#modal-x").onclick = closeModal;
  const inp = $("#modal-body input:not([type=checkbox]):not([type=range]):not([type=file])"); if (inp) inp.focus();
}
function closeModal() { $("#modal").classList.add("hidden"); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); $("#summary").classList.add("hidden"); } });

// ---------- timer ----------
const timer = { kind: "focus", mode: (S.lens[0] || 25) * 60, running: false, startAt: 0, pausedElapsed: 0, tickH: null };
const RING_LEN = 2 * Math.PI * 84;
function elapsed() { return timer.pausedElapsed + (timer.running ? (Date.now() - timer.startAt) / 1000 : 0); }
const studyingNow = () => timer.running && timer.kind === "focus";

function drawTicks() {
  $("#ring-ticks").innerHTML = Array.from({ length: 60 }, (_, i) => {
    const a = i * 6 * Math.PI / 180, r1 = 94, r2 = i % 5 === 0 ? 98.5 : 96.5;
    return `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}"/>`;
  }).join("");
}

function presets() { return timer.kind === "focus" ? S.lens : S.breakLens; }
function renderModes() {
  const names = timer.kind === "focus" ? ["Focus", "Deep", "Flow"] : ["Quick", "Recharge", "Long"];
  $("#mode-row").innerHTML = presets().map((m, i) => `<button class="mode ${timer.mode === m * 60 ? "active" : ""}" data-min="${m}">${names[i] || "Timer"} ${m}</button>`).join("")
    + (timer.kind === "focus" ? `<button class="mode ${timer.mode === 0 ? "active" : ""}" data-min="0">Stopwatch</button>` : "");
  $$(".mode").forEach(b => b.onclick = () => {
    if (setMode(Number(b.dataset.min))) { $$(".mode").forEach(x => x.classList.remove("active")); b.classList.add("active"); }
  });
}

function setKind(kind) {
  if (timer.running || elapsed() > 0) {
    if (!confirm("Discard the current session?")) return false;
    stopTicking(); timer.running = false; timer.pausedElapsed = 0;
    document.body.classList.remove("running");
    sendPresence();
  }
  timer.kind = kind;
  document.body.classList.toggle("break", kind === "break");
  $$("#timer-seg button").forEach(b => b.classList.toggle("sel", b.dataset.kind === kind));
  timer.mode = (presets()[0] || 25) * 60;
  renderModes(); resetTimerUI();
  return true;
}

function renderTimer() {
  const el = elapsed();
  const isDown = timer.mode > 0;
  const shown = isDown ? Math.max(0, timer.mode - el) : el;
  $("#clock").textContent = fmtClock(shown);
  const frac = isDown ? Math.min(1, el / timer.mode) : (el % 3600) / 3600;
  $("#ring-fg").style.strokeDashoffset = RING_LEN * (1 - frac);
  $("#clock-sub").textContent = timer.kind === "break"
    ? (timer.running ? "break — recharge" : el > 0 ? "break paused" : "ready to rest")
    : timer.running ? ($("#activity").value.trim() || "locked in") : (el > 0 ? "paused" : "ready");
  document.title = timer.running ? `${fmtClock(shown)} · LockIn` : "LockIn";
  if (isDown && timer.running && el >= timer.mode) timer.kind === "break" ? breakDone() : finishSession(true);
}

function setMode(min) {
  if (elapsed() > 0 && !confirm("Discard the current session?")) return false;
  stopTicking(); timer.mode = min * 60; timer.pausedElapsed = 0; timer.running = false;
  document.body.classList.remove("running");
  resetTimerUI();
  return true;
}
function stopTicking() { clearInterval(timer.tickH); timer.tickH = null; }
function resetTimerUI() {
  $("#btn-main").textContent = "Start";
  $("#btn-finish").classList.add("hidden");
  $("#ring-fg").style.strokeDashoffset = RING_LEN;
  $("#clock").textContent = timer.mode ? fmtClock(timer.mode) : "00:00";
  $("#clock-sub").textContent = timer.kind === "break" ? "ready to rest" : "ready";
  document.title = "LockIn";
}
function startTicking() {
  timer.running = true; timer.startAt = Date.now();
  timer.tickH = setInterval(renderTimer, 1000);
  document.body.classList.add("running");
  $("#btn-main").textContent = "Pause";
  $("#btn-finish").classList.toggle("hidden", timer.kind === "break");
  renderTimer();
}

$("#btn-main").onclick = () => {
  if (!timer.running) {
    startTicking();
    sfx.start(); sendPresence();
  } else {
    timer.pausedElapsed = elapsed(); timer.running = false; stopTicking();
    document.body.classList.remove("running");
    $("#btn-main").textContent = "Resume";
    sfx.pause(); renderTimer(); sendPresence();
  }
};
$("#btn-finish").onclick = () => finishSession(false);

function breakDone() {
  stopTicking(); timer.running = false; timer.pausedElapsed = 0;
  document.body.classList.remove("running");
  sfx.complete(); notify("Break's over", "Time to lock back in.");
  setKindSilent("focus");
  toast("Break's over — ready for another round?");
}
function setKindSilent(kind) { // switch without the discard prompt (session already handled)
  timer.kind = kind; timer.pausedElapsed = 0; timer.running = false;
  document.body.classList.toggle("break", kind === "break");
  $$("#timer-seg button").forEach(b => b.classList.toggle("sel", b.dataset.kind === kind));
  timer.mode = (presets()[0] || 25) * 60;
  renderModes(); resetTimerUI();
}

async function finishSession(completed) {
  const secs = Math.floor(elapsed());
  const act = $("#activity").value.trim();
  stopTicking(); timer.running = false; timer.pausedElapsed = 0;
  document.body.classList.remove("running");
  resetTimerUI();
  if (secs >= 60) {
    try {
      const r = await api("/api/session", { seconds: secs, activity: actName() });
      sessionDots(true);
      if (completed) {
        sfx.complete(); confetti();
        notify("Session complete", `${fmtHM(secs)} of focus — nice work.`);
        showSummary(secs, act, r);
      } else {
        sfx.coin();
        toast(`+${r.coinsEarned} coins · ${fmtHM(secs)} logged · streak ${r.streak}`);
      }
      refresh();
    } catch (e) { sfx.error(); toast("Couldn't save session: " + e.message); }
  } else if (secs > 0) toast("Under a minute — not logged");
  sendPresence();
}

function showSummary(secs, act, r) {
  $("#sum-time").textContent = fmtClock(secs);
  $("#sum-act").textContent = act || "focus session";
  $("#sum-coins").textContent = "+" + r.coinsEarned;
  $("#sum-streak").textContent = r.streak;
  $("#sum-xp").textContent = "+" + r.coinsEarned;
  $("#summary").classList.remove("hidden");
}
$("#sum-break").onclick = () => { $("#summary").classList.add("hidden"); setKindSilent("break"); startTicking(); sfx.start(); };
$("#sum-again").onclick = () => { $("#summary").classList.add("hidden"); startTicking(); sfx.start(); sendPresence(); };
$("#summary").onclick = (e) => { if (e.target === $("#summary")) $("#summary").classList.add("hidden"); };

$("#timer-seg").onclick = (e) => {
  const b = e.target.closest("button"); if (!b || b.dataset.kind === timer.kind) return;
  setKind(b.dataset.kind);
};

const actName = () => S.hideAct ? "" : $("#activity").value.trim();
async function sendPresence() {
  if (S.offline) return;
  try { await api("/api/presence", { studying: studyingNow(), activity: actName(), elapsed: Math.floor(elapsed()) }); } catch {}
}
setInterval(() => { if (studyingNow()) sendPresence(); }, 5000);

// ---------- greeting ----------
const GREET_SUBS = [
  "Small steps, every day.",
  "Show up for future you.",
  "Consistency beats intensity.",
  "One session at a time.",
  "Your friends are counting on you.",
];
function renderGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Late night grind" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = state?.me?.name;
  $("#greet-title").innerHTML = `${part}${name ? `, <em>${esc(name)}</em>` : ""}`;
  $("#greet-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  if (state?.me) {
    const left = S.goal * 60 - withLive(state.me, state.me.today);
    const days = examDaysLeft();
    const exam = days > 0 ? `⏳ ${days} day${days === 1 ? "" : "s"} until your exam · ` : "";
    $("#greet-sub").textContent = exam + (left > 0
      ? `${fmtHM(left)} to your daily goal — ${GREET_SUBS[new Date().getDate() % GREET_SUBS.length].toLowerCase()}`
      : "Daily goal complete. Anything extra is a victory lap.");
  }
}

// ---------- state ----------
let state = null, stateAt = 0;
let curGroup = localStorage.getItem("curGroup") || "";
let curRange = "today";

function liveExtra(m) {
  if (m.id === cfg.userId) return studyingNow() ? elapsed() : 0;
  return m.studying ? m.elapsed + (Date.now() - stateAt) / 1000 : 0;
}
const withLive = (m, base) => base + liveExtra(m);
const isLive = (m) => m.studying || (m.id === cfg.userId && studyingNow());

async function refresh() {
  if (!cfg.userId) return;
  try {
    state = await api("/api/state");
    stateAt = Date.now();
  } catch (e) {
    if (String(e.message).includes("bad credentials")) {
      ["userId", "secret", "curGroup"].forEach(k => localStorage.removeItem(k));
      location.reload();
      return;
    }
    if (!timer.running && elapsed() === 0) $("#clock-sub").textContent = "offline";
    return;
  }
  if (!timer.running && elapsed() === 0 && timer.kind === "focus") $("#clock-sub").textContent = "ready";
  const sel = $("#group-select");
  if (!state.groups.find(g => g.code === curGroup)) curGroup = state.groups[0]?.code || "";
  sel.innerHTML = state.groups.map(g => `<option value="${g.code}" ${g.code === curGroup ? "selected" : ""}>${esc(g.name)}</option>`).join("") || `<option value="">No group yet</option>`;
  renderAll();
}

function renderAll() {
  if (!state) return;
  const me = state.me;
  countUp($("#hdr-coins"), me.coins);
  countUp($("#hdr-streak"), me.streak);
  $("#hdr-name").textContent = me.name;
  $("#hdr-lvl").textContent = "LV " + levelOf(me);
  $("#hdr-avatar").outerHTML = av(me, "av-sm").replace("<span", '<span id="hdr-avatar"');
  const lvl = levelOf(me), xp = xpOf(me), lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
  countUp($("#xp-lvl"), lvl);
  $("#xp-mini-fill").style.width = Math.min(100, (xp - lo) / (hi - lo) * 100) + "%";
  renderGreeting();

  const today = withLive(me, me.today);
  const goalS = S.goal * 60;
  $("#goal-val").textContent = `${fmtHM(today)} / ${fmtHM(goalS)}`;
  $("#goal-fill").style.width = Math.min(100, today / goalS * 100) + "%";
  $("#st-today").textContent = fmtHM(today);
  $("#st-week").textContent = fmtHM(withLive(me, me.week));
  $("#st-best").textContent = fmtHM(Math.max(...(me.days || [0]), today));
  $("#st-total").textContent = fmtHM(withLive(me, me.totalSeconds));
  renderChart(me);
  sessionDots(false);

  document.documentElement.dataset.shopTheme = me.theme || "";
  const sh = $("#streak-shield");
  sh.classList.toggle("hidden", !(me.freezes > 0));
  if (me.freezes > 0) sh.querySelector("b").textContent = "×" + me.freezes;
  deliverNudges(me);
  renderQuests(me);
  renderWarRoom(me);
  const g = state.groups.find(x => x.code === curGroup);
  renderQuiz(g);
  renderRoom(g);
  renderMembers(g);
  renderLive(g);
  renderBoard(g);
  renderChallenges(g);
  renderSquadChat(g);
  recapCheck(me, g);
}

function renderChart(me) {
  const days = [...(me.days || [])];
  if (days.length) days[6] = withLive(me, me.days[6]);
  const max = Math.max(...days, S.goal * 60, 1);
  const names = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 864e5).toLocaleDateString(undefined, { weekday: "narrow" }));
  $("#chart").innerHTML = days.map((s, i) => `
    <div class="col ${s === 0 ? "dimmed" : ""} ${i === 6 ? "today" : ""}" title="${fmtHM(s)}">
      <div class="bar" style="height:${Math.max(4, s / max * 100)}%"></div><span class="lbl">${names[i]}</span>
    </div>`).join("");
}

const EMPTY_RING = `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2.5" stroke-dasharray="6 5"/><circle cx="24" cy="24" r="8" stroke="currentColor" stroke-width="2.5"/></svg>`;

function renderMembers(g) {
  const strip = $("#member-strip");
  if (!g) { strip.innerHTML = ""; return; }
  const ms = [...g.members].sort((a, b) => isLive(b) - isLive(a));
  strip.innerHTML = ms.map(m => `<div class="member ${isLive(m) ? "live" : ""}" title="${esc(m.name)} · LV ${levelOf(m)}${isLive(m) ? " · studying" : ""}">
      <span style="position:relative">${av(m, "av-lg")}<span class="status"></span></span>
      <span class="mname">${esc(m.name)}</span></div>`).join("");
  settle(strip);
}

function renderLive(g) {
  const members = g ? g.members : state ? [state.me] : [];
  const live = members.filter(isLive)
    .map(m => ({ ...m, el: liveExtra(m), act: m.id === cfg.userId ? actName() : m.activity }));
  $("#live-list").innerHTML = live.length ? live.map(m => `
    <div class="live-item">
      <span class="live-dot"></span>${av(m, "av-sm")}
      <span class="live-name">${esc(m.name)}</span>
      <span class="live-act">${esc(m.act || "studying")}</span>
      <span class="live-time">${fmtClock(m.el)}</span>
    </div>`).join("") : `<div class="empty">${EMPTY_RING}<span>Quiet in here. Start the timer and take the lead.</span></div>`;
  settle($("#live-list"));
}

// entrance animations play once per view; live re-renders skip them (no per-second replay)
function settle(el) { // suppress entrance replay on live re-renders, after the first entrance finishes
  if (!el._settleH) el._settleH = setTimeout(() => { el.classList.add("settled"); el._settleH = 0; }, 500);
}
function unsettle() { ["#board", "#podium", "#live-list", "#chal-list", "#member-strip"].forEach(s => { const el = $(s); el.classList.remove("settled"); clearTimeout(el._settleH); el._settleH = 0; }); }

function renderBoard(g) {
  const pod = $("#podium"), el = $("#board"), rl = $("#rank-line");
  if (!g) {
    pod.innerHTML = ""; rl.classList.add("hidden");
    el.innerHTML = `<div class="empty">${EMPTY_RING}<span>Compete with friends on hours studied.</span><span class="e-act" onclick="document.querySelector('#btn-newgroup').click()">Create or join a group</span></div>`;
    return;
  }
  const key = curRange === "today" ? "today" : curRange === "week" ? "week" : "totalSeconds";
  const roster = [...g.members];
  if (state.me.rival) roster.push(state.me.rival); // your AI rival races you on the board
  const rows = roster.map(m => ({ ...m, v: withLive(m, m[key]) })).sort((a, b) => b.v - a.v);
  // rank callout
  const myIdx = rows.findIndex(m => m.id === cfg.userId);
  if (myIdx >= 0 && rows.length > 1) {
    const label = { today: "today", week: "this week", total: "all time" }[curRange];
    if (myIdx === 0) {
      const lead = rows[0].v - rows[1].v;
      rl.innerHTML = `You're <b>#1 ${label}</b> — ${fmtHM(lead)} ahead of ${esc(rows[1].name)}. Keep it that way.`;
    } else {
      const gap = rows[myIdx - 1].v - rows[myIdx].v;
      rl.innerHTML = `You're <b>#${myIdx + 1} ${label}</b> — ${fmtHM(gap)} behind ${esc(rows[myIdx - 1].name)}.`;
    }
    rl.classList.remove("hidden");
  } else rl.classList.add("hidden");
  // FLIP: capture old row positions so rank changes glide instead of jump-cutting
  const oldTops = {};
  $$("#board .board-row[data-id]").forEach(r => oldTops[r.dataset.id] = r.offsetTop);
  pod.innerHTML = rows.slice(0, 3).map((m, i) => `
    <div class="pod p${i + 1}" style="order:${[1, 0, 2][i]}">
      <span style="position:relative">${av(m, i === 0 ? "av-xl" : "av-lg")}<span class="pod-rank">${i + 1}</span></span>
      <span class="pname">${esc(m.name)}</span><span class="ptime">${fmtHM(m.v)}</span>
    </div>`).join("");
  el.innerHTML = rows.slice(3).map((m, i) => `
    <div class="board-row ${m.id === cfg.userId ? "me" : ""} ${m.isRival ? "rival-row" : ""}" data-id="${m.id}">
      <span class="rank">${i + 4}</span>${av(m)}
      <div class="board-name"><span>${esc(m.name)}</span>${m.isRival ? `<span class="rival-tag">BOT</span>` : flairChip(m)}${m.streak > 1 ? `<span class="streak-badge"><svg class="ic" viewBox="0 0 24 24"><path d="M13.5 1.5s.75 2.25.75 4.5c0 2.16-1.35 3.75-3.53 3.75-2.19 0-3.72-1.59-3.72-3.75l.03-.36C4.9 8.18 3.75 10.94 3.75 13.5c0 4.56 3.69 8.25 8.25 8.25s8.25-3.69 8.25-8.25c0-5.56-2.67-10.52-6.75-12Z" fill="#ff9d42"/></svg>${m.streak}</span>` : ""}${isLive(m) ? `<span class="live-dot"></span>` : ""}</div>
      <span class="board-time">${fmtHM(m.v)}</span>
      ${!isLive(m) && m.id !== cfg.userId && !m.isRival ? `<button class="nudge-btn" data-nudge="${m.id}" title="Nudge ${esc(m.name)} to get back to work"><svg class="ic" viewBox="0 0 24 24"><path d="M11 2h2v9h-2V2Zm-4.2 2.3 1.4 1.4C6.8 7.1 6 8.7 6 10.5 6 14.1 8.9 17 12.5 17c-.2 0-.4 0 0 0 3.3-.3 6-3 6-6.5 0-1.8-.8-3.4-2.2-4.8l1.4-1.4C19.5 6 20.5 8.1 20.5 10.5c0 4.2-3.1 7.7-7.2 8.4l.7 3.1h-4l.7-3.1c-4.1-.7-7.2-4.2-7.2-8.4 0-2.4 1-4.5 2.3-6.2Z"/></svg></button>` : ""}
    </div>`).join("");
  $$("#board .board-row[data-id]").forEach(r => {
    const d = (oldTops[r.dataset.id] ?? r.offsetTop) - r.offsetTop;
    if (!d) return;
    r.style.transform = `translateY(${d}px)`;
    requestAnimationFrame(() => { r.classList.add("flip"); r.style.transform = ""; setTimeout(() => r.classList.remove("flip"), 400); });
  });
  settle(el); settle(pod);
}

const CHAL_LABEL = { solo: "Solo goal", race: "Race", team: "Team goal", streak: "Streak" };
function renderChallenges(g) {
  const el = $("#chal-list");
  if (!g) { el.innerHTML = `<div class="empty">${EMPTY_RING}<span>Join a group to start challenges.</span></div>`; return; }
  const byId = Object.fromEntries(g.members.map(m => [m.id, m]));
  const cs = [...g.challenges].sort((a, b) => (a.winner ? 1 : 0) - (b.winner ? 1 : 0) || b.createdAt - a.createdAt);
  el.innerHTML = cs.map(c => {
    const since = new Date(c.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const goal = c.target * 3600;
    const prog = (id) => (c.progress[id] || 0) + (c.winner || c.type === "streak" ? 0 : (byId[id] ? liveExtra(byId[id]) : 0));
    let rows, sub;
    if (c.type === "streak") {
      sub = `Keep a ${c.target}-day streak · started ${since}`;
      rows = Object.entries(c.streaks || {}).sort((a, b) => b[1] - a[1])
        .map(([id, s]) => bar(byId[id] || { name: "?" }, s, c.target, `<b>${s}</b><span class="of"> / ${c.target}d</span>`)).join("");
    } else if (c.type === "team") {
      const tot = g.members.reduce((a, m) => a + prog(m.id), 0);
      sub = `${c.target}h together · started ${since}`;
      rows = bar({ name: "Team", avatar: 3 }, tot, goal, `<b>${fmtHM(tot)}</b><span class="of"> / ${c.target}h</span>`) +
        g.members.map(m => ({ m, v: prog(m.id) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v)
          .map(({ m, v }) => bar(m, v, goal, `<b>${fmtHM(v)}</b>`)).join("");
    } else {
      sub = `${c.type === "race" ? "First to" : "Everyone reach"} ${c.target}h · started ${since}`;
      const rs = g.members.map(m => ({ m, v: prog(m.id) })).sort((a, b) => b.v - a.v);
      rows = rs.map(({ m, v }) => bar(m, v, goal, `<b>${fmtHM(v)}</b><span class="of"> / ${c.target}h</span>`)).join("") || `<div class="empty"><span>No hours logged yet</span></div>`;
    }
    return `<div class="chal">
      <div class="chal-head"><span class="chal-title">${esc(c.title)}</span><span class="chal-type t-${c.type}">${CHAL_LABEL[c.type]}</span></div>
      <div class="chal-sub">${sub}</div>${rows}
      ${c.winnerName ? `<div class="chal-win"><svg class="ic" viewBox="0 0 24 24" fill="#ffc94d"><path d="M5 3h14v2h3v4a5 5 0 0 1-5 5h-.42A6 6 0 0 1 13 17.92V20h4v2H7v-2h4v-2.08A6 6 0 0 1 7.42 14H7a5 5 0 0 1-5-5V5h3V3Zm14 4v3a3 3 0 0 0 3-3h-3ZM5 7H2a3 3 0 0 0 3 3V7Z"/></svg>${c.winnerName === "team" ? "Goal reached — team win!" : esc(c.winnerName) + " wins!"}</div>` : ""}
    </div>`;
  }).join("") || `<div class="empty">${EMPTY_RING}<span>No challenges yet. Race a friend to 10 hours.</span><span class="e-act" onclick="document.querySelector('#btn-newchal').click()">Start a challenge</span></div>`;
  settle(el);
  function bar(m, val, max, label) {
    const pct = Math.min(100, val / max * 100);
    return `<div class="chal-row">
      <div class="chal-row-top">${av(m, "av-sm")}<span class="nm">${esc(m.name)}</span><span class="val">${label}</span></div>
      <div class="chal-bar ${pct >= 100 ? "done" : ""}"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>`;
  }
}

// live re-render every second (uses cached state, no network)
setInterval(() => {
  if (!state) return;
  const g = state.groups.find(x => x.code === curGroup);
  if (studyingNow() || g?.members.some(m => m.studying)) renderAll();
}, 1000);
setInterval(renderGreeting, 60000);

// ---------- actions ----------
$("#group-select").onchange = (e) => { curGroup = e.target.value; localStorage.setItem("curGroup", curGroup); unsettle(); renderAll(); };
$$(".range").forEach(b => b.onclick = () => { $$(".range").forEach(x => x.classList.remove("active")); b.classList.add("active"); curRange = b.dataset.r; unsettle(); renderAll(); });
$$(".tab").forEach(b => b.onclick = () => {
  $$(".tab").forEach(x => x.classList.remove("active")); b.classList.add("active");
  $("#tab-board").classList.toggle("hidden", b.dataset.tab !== "board");
  $("#tab-challenges").classList.toggle("hidden", b.dataset.tab !== "challenges");
  unsettle(); renderAll();
});

function inputErr(el) {
  el.classList.add("input-err"); el.focus();
  setTimeout(() => el.classList.remove("input-err"), 900);
}
$("#btn-newgroup").onclick = () => modal("New or join group", `
  <label>Create a group</label><input id="m-gname" placeholder="Group name" maxlength="32">
  <label>— or join with a code —</label><input id="m-gcode" placeholder="e.g. A3F9C2" maxlength="6" style="text-transform:uppercase">`,
  async () => {
    const code = $("#m-gcode").value.trim();
    if (!code && !$("#m-gname").value.trim()) { inputErr($("#m-gname")); return false; }
    try {
      if (code) { const r = await api("/api/group/join", { code }); curGroup = r.code; }
      else { const r = await api("/api/group", { name: $("#m-gname").value.trim() }); curGroup = r.code; toast(`Group created — invite code: ${r.code}`); }
      localStorage.setItem("curGroup", curGroup); unsettle(); refresh();
    } catch (e) { sfx.error(); toast(e.message); if (code) inputErr($("#m-gcode")); return false; }
  }, "Go");

$("#btn-invite").onclick = () => {
  if (!curGroup) return toast("No group selected");
  modal("Invite friends", `<p class="muted">Friends join with this code (same server address):</p><div class="code-display">${curGroup}</div>`,
    async () => { try { await navigator.clipboard.writeText(curGroup); toast("Code copied!"); } catch {} }, "Copy code");
};

$("#btn-newchal").onclick = () => {
  if (!curGroup) return toast("Join a group first");
  modal("New challenge", `
    <label>Title</label><input id="m-ct" placeholder="e.g. Finals grind" maxlength="48">
    <label>Type</label><select id="m-ctype">
      <option value="race">Race — first to the target wins</option>
      <option value="team">Team goal — combined hours</option>
      <option value="solo">Solo goal — everyone races their own target</option>
      <option value="streak">Streak — study daily</option></select>
    <label>Target (hours, or days for streak)</label><input id="m-cn" type="number" min="1" max="1000" value="10">`,
    async () => {
      try {
        await api("/api/challenge", { groupCode: curGroup, type: $("#m-ctype").value, title: $("#m-ct").value.trim(), target: Number($("#m-cn").value) });
        refresh(); toast("Challenge created");
      } catch (e) { sfx.error(); toast(e.message); return false; }
    }, "Create");
};

// ---------- profile (with photo upload) ----------
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      const ctx = cv.getContext("2d");
      const s = Math.min(img.width, img.height); // center-crop square
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      resolve(cv.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

$("#btn-profile").onclick = () => {
  const me = state?.me; if (!me) return;
  let sel = me.avatar || 0;
  let img = me.avatarImg;           // undefined = unchanged, "" = remove, data: = new upload
  let imgDirty = false;
  const lvl = levelOf(me), xp = xpOf(me), lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
  modal("Profile", `
    <div class="pf-head">
      <span id="m-avprev">${av(me, "av-xl")}</span>
      <div class="pf-upload">
        <button class="btn small ghost" id="m-upload">Upload photo</button>
        <button class="btn small ghost ${me.avatarImg ? "" : "hidden"}" id="m-rmphoto">Remove photo</button>
      </div>
      <input type="file" id="m-file" accept="image/png,image/jpeg,image/webp" class="hidden">
    </div>
    <div class="xp-line">
      <div class="xp-text"><span>Level ${lvl}</span><span>${xp - lo} / ${hi - lo} xp to level ${lvl + 1}</span></div>
      <div class="xp-bar"><i style="width:${Math.min(100, (xp - lo) / (hi - lo) * 100)}%"></i></div>
    </div>
    <label>Display name</label><input id="m-pname" value="${esc(me.name)}" maxlength="24">
    <label>Or pick a gradient</label><div class="av-grid" id="m-avgrid">${Array.from({ length: 12 }, (_, i) =>
      `<span class="avatar av${i} ${i === sel && !me.avatarImg ? "sel" : ""}" data-i="${i}">${esc(me.name[0].toUpperCase())}</span>`).join("")}</div>`,
    async () => {
      try {
        const body = { name: $("#m-pname").value.trim(), avatar: sel };
        if (imgDirty) body.avatarImg = img || "";
        await api("/api/profile", body);
        refresh(); toast("Profile updated");
      } catch (e) { sfx.error(); toast(e.message); return false; }
    });
  const preview = () => { $("#m-avprev").innerHTML = av({ name: $("#m-pname").value.trim() || me.name, avatar: sel, avatarImg: img }, "av-xl"); };
  $("#m-upload").onclick = () => $("#m-file").click();
  $("#m-file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      img = await resizeImage(f); imgDirty = true;
      $("#m-rmphoto").classList.remove("hidden");
      $$("#m-avgrid .avatar").forEach(x => x.classList.remove("sel"));
      preview();
    } catch { toast("Couldn't read that image"); }
  };
  $("#m-rmphoto").onclick = () => {
    img = ""; imgDirty = true;
    $("#m-rmphoto").classList.add("hidden");
    $$("#m-avgrid .avatar").forEach(x => x.classList.toggle("sel", Number(x.dataset.i) === sel));
    preview();
  };
  $("#m-avgrid").onclick = (e) => {
    const a = e.target.closest(".avatar"); if (!a) return;
    sel = Number(a.dataset.i);
    if (img) { img = ""; imgDirty = true; $("#m-rmphoto").classList.add("hidden"); }
    $$("#m-avgrid .avatar").forEach(x => x.classList.toggle("sel", Number(x.dataset.i) === sel));
    preview();
  };
};

// ---------- settings ----------
$("#btn-settings").onclick = () => {
  modal("Settings", `
    <label>Theme</label>
    <div class="seg" id="m-theme"><button data-v="dark" class="${S.theme === "dark" ? "sel" : ""}">Dark</button><button data-v="light" class="${S.theme === "light" ? "sel" : ""}">Light</button></div>
    <label>Accent color</label>
    <div class="swatches" id="m-accent">${["violet", "green", "blue", "rose", "amber"].map(a =>
      `<span class="swatch ${S.accent === a ? "sel" : ""}" data-v="${a}" style="background:${{ violet: "#7c6cff", green: "#22c47d", blue: "#3f8cff", rose: "#f0568f", amber: "#f59e2d" }[a]}"></span>`).join("")}</div>
    ${row("Sound effects", "Subtle UI feedback sounds", `<label class="switch"><input type="checkbox" id="m-sfx" ${S.sfx ? "checked" : ""}><span class="sl"></span></label>`)}
    ${row("Volume", "أصوات الواجهة", `<input type="range" id="m-vol" min="0" max="1" step="0.1" value="${S.vol}">`)}
    ${row("صوت الخلفية", "مستوى المطر/الروقان وغيره", `<input type="range" id="m-ambvol" min="0" max="1" step="0.05" value="${S.ambVol ?? 0.6}">`)}
    ${row("Notifications", "Desktop alert when a session or break ends", `<label class="switch"><input type="checkbox" id="m-notif" ${S.notif ? "checked" : ""}><span class="sl"></span></label>`)}
    ${row("Daily goal", "Minutes of focus per day", `<input type="number" id="m-goal" min="15" max="960" step="15" value="${S.goal}" style="width:84px">`)}
    ${row("Focus presets", "Three lengths, minutes", `<input id="m-lens" value="${S.lens.join(", ")}" style="width:110px">`)}
    ${row("Break presets", "Three lengths, minutes", `<input id="m-blens" value="${S.breakLens.join(", ")}" style="width:110px">`)}
    ${row("Appear offline", "Hide your live status from friends", `<label class="switch"><input type="checkbox" id="m-off" ${S.offline ? "checked" : ""}><span class="sl"></span></label>`)}
    ${row("Hide activity text", "Show only that you're studying, not what", `<label class="switch"><input type="checkbox" id="m-hact" ${S.hideAct ? "checked" : ""}><span class="sl"></span></label>`)}
    <label>Server address</label><input id="m-server" value="${esc(cfg.server)}">`,
    async () => {
      S.theme = $("#m-theme .sel")?.dataset.v || "dark";
      S.accent = $("#m-accent .sel")?.dataset.v || "violet";
      S.sfx = $("#m-sfx").checked; S.vol = Number($("#m-vol").value);
      const prevAmbVol = S.ambVol;
      S.ambVol = Number($("#m-ambvol").value);
      if (amb && S.ambVol !== prevAmbVol) startAmbient(); // restart so the per-preset trim applies
      S.goal = Math.max(15, Number($("#m-goal").value) || 180);
      S.offline = $("#m-off").checked; S.hideAct = $("#m-hact").checked;
      const parseLens = (v, cur) => { const l = v.split(",").map(x => Math.min(600, Math.max(1, parseInt(x)))).filter(Boolean).slice(0, 3); return l.length ? l : cur; };
      S.lens = parseLens($("#m-lens").value, S.lens);
      S.breakLens = parseLens($("#m-blens").value, S.breakLens);
      const wantNotif = $("#m-notif").checked;
      if (wantNotif && Notification.permission !== "granted") await Notification.requestPermission().catch(() => {});
      S.notif = wantNotif && Notification.permission === "granted";
      saveS();
      if (!timer.running && elapsed() === 0) { timer.mode = (presets()[0] || 25) * 60; resetTimerUI(); }
      renderModes(); refresh();
      const v = $("#m-server").value.trim().replace(/\/+$/, "");
      if (v && v !== cfg.server) { cfg.server = v; location.reload(); }
    });
  function row(lab, sub, ctl) {
    return `<div class="set-row"><div><div class="set-lab">${lab}</div>${sub ? `<div class="set-sub">${sub}</div>` : ""}</div>${ctl}</div>`;
  }
  $("#m-theme").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; $$("#m-theme button").forEach(x => x.classList.toggle("sel", x === b)); };
  $("#m-accent").onclick = (e) => { const s = e.target.closest(".swatch"); if (!s) return; $$("#m-accent .swatch").forEach(x => x.classList.toggle("sel", x === s)); };
};

// ---------- AI study assistant ----------
const aiChat = JSON.parse(localStorage.getItem("aiChat") || "[]");
function saveChat() { localStorage.setItem("aiChat", JSON.stringify(aiChat.slice(-40))); }
// markdown-lite: escape first, then **bold**, `code`, and "- " bullet lists
function mdLite(s) {
  let h = esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
  h = h.replace(/(?:^|\n)((?:[-•] .*(?:\n|$))+)/g, (_, block) =>
    "\n<ul>" + block.trim().split("\n").map(l => `<li>${l.replace(/^[-•] /, "")}</li>`).join("") + "</ul>");
  return h;
}
const aiSaved = JSON.parse(localStorage.getItem("aiSaved") || "[]");
let savedView = false;
function saveSaved() { localStorage.setItem("aiSaved", JSON.stringify(aiSaved.slice(-100))); updateSavedBadge(); }
function updateSavedBadge() {
  const n = $("#ai-saved-n");
  n.textContent = aiSaved.length;
  n.classList.toggle("hidden", !aiSaved.length);
}
function renderChat() {
  const box = $("#ai-msgs");
  if (savedView) {
    box.innerHTML = aiSaved.length
      ? aiSaved.map((s, i) => `<div class="ai-saved-item" dir="auto"><button class="unsave" data-i="${i}" title="حذف">✕</button>${mdLite(s.content)}</div>`).join("")
      : `<div class="ai-hello">دفتر الأخطاء فاضي — علّم أي جواب من المساعد بنجمة عشان يحفظ هنا وتراجعه قبل الاختبار.</div>`;
    box.scrollTop = 0;
    return;
  }
  box.innerHTML = aiChat.length
    ? aiChat.map((m, i) => `<div class="ai-msg ${m.role === "user" ? "user" : "bot"}" dir="auto">${m.role === "user" ? esc(m.content) : `<button class="save-btn ${aiSaved.some(s => s.content === m.content) ? "on" : ""}" data-i="${i}" title="احفظ في دفتر الأخطاء">★</button>` + mdLite(m.content)}${m.model ? `<span class="model-tag">${esc(m.model.split("/").pop().replace(":free", ""))}</span>` : ""}</div>`).join("")
    : `<div class="ai-hello">اختر اختبارك فوق، وحدد تاريخه — وبعدها اسأل، أو اطلب سؤال تدريب، أو خطة مذاكرة.</div>`;
  box.scrollTop = box.scrollHeight;
}
$("#ai-msgs").addEventListener("click", (e) => {
  const sv = e.target.closest(".save-btn");
  if (sv) {
    const m = aiChat[Number(sv.dataset.i)];
    const idx = aiSaved.findIndex(s => s.content === m.content);
    if (idx >= 0) aiSaved.splice(idx, 1); else aiSaved.push({ content: m.content, at: Date.now() });
    saveSaved(); renderChat(); return;
  }
  const un = e.target.closest(".unsave");
  if (un) { aiSaved.splice(Number(un.dataset.i), 1); saveSaved(); renderChat(); }
});
$("#ai-saved").onclick = () => {
  savedView = !savedView;
  $("#ai-saved").classList.toggle("active", savedView);
  renderChat();
};
let aiBusy = false;
async function aiSend() {
  const inp = $("#ai-input");
  const text = inp.value.trim();
  if (!text || aiBusy) return;
  if (savedView) { savedView = false; $("#ai-saved").classList.remove("active"); }
  inp.value = ""; inp.style.height = "auto";
  aiChat.push({ role: "user", content: text }); saveChat(); renderChat();
  aiBusy = true;
  const box = $("#ai-msgs");
  box.insertAdjacentHTML("beforeend", `<div class="ai-msg bot thinking" id="ai-think"><i></i><i></i><i></i></div>`);
  box.scrollTop = box.scrollHeight;
  // action requests ("ابدأ ٥٠ دقيقة رياضيات") execute instead of just replying
  try {
    if (await tryCommand(text)) {
      aiChat.pop(); saveChat(); renderChat();
      aiBusy = false;
      return;
    }
  } catch {}
  try {
    const ctx = {
      exam: S.exam || "general",
      daysLeft: examDaysLeft(),
      activity: $("#activity").value.trim(),
      todayMin: state ? Math.floor(withLive(state.me, state.me.today) / 60) : 0,
      streak: state?.me?.streak || 0,
    };
    const r = await api("/api/ai", { messages: aiChat.slice(-12).map(({ role, content }) => ({ role, content })), ctx });
    aiChat.push({ role: "assistant", content: r.reply, model: r.model }); saveChat();
    sfx.click(); speakReply(r.reply);
  } catch (e) {
    aiChat.push({ role: "assistant", content: "⚠ " + e.message }); // shown but not resent as context (filtered server-side by role anyway)
    sfx.error();
  }
  aiBusy = false;
  renderChat();
}
$("#ai-fab").onclick = () => { $("#ai-panel").classList.toggle("hidden"); if (!$("#ai-panel").classList.contains("hidden")) { renderChat(); $("#ai-input").focus(); } };
$("#ai-close").onclick = () => $("#ai-panel").classList.add("hidden");
$("#ai-clear").onclick = () => { aiChat.length = 0; saveChat(); renderChat(); };
$("#ai-send").onclick = aiSend;
$("#ai-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); aiSend(); }
});
$("#ai-input").addEventListener("input", (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(120, e.target.scrollHeight) + "px"; });
function examDaysLeft() {
  if (!S.examDate) return 0;
  return Math.ceil((new Date(S.examDate) - Date.now()) / 864e5);
}
$("#ai-chips").onclick = (e) => {
  const chip = e.target.closest(".ai-chip"); if (!chip || aiBusy) return;
  if (savedView) { savedView = false; $("#ai-saved").classList.remove("active"); }
  const act = $("#activity").value.trim();
  const days = examDaysLeft();
  const prompts = {
    quiz: `درّبني بسؤال واحد بمستوى الاختبار الحقيقي${act ? ` على ${act}` : ""} — أربعة خيارات، وانتظر جوابي.`,
    explain: act ? `اشرح لي ${act} شرح مختصر وواضح مع مثال واحد بأسلوب أسئلة الاختبار.` : "بقولك مفهوم واشرحه لي مختصر مع مثال بأسلوب الاختبار. جاهز؟",
    plan: days > 0 ? `باقي ${days} يوم على اختباري. اعطني خطة مذاكرة واقعية للمدة المتبقية — أيام وأقسام محددة، بدون كلام عام.` : "اعطني خطة مذاكرة لجلستي الجاية — 3 إلى 5 خطوات محددة فقط.",
    weak: "اسألني 3 أسئلة سريعة من أقسام مختلفة عشان تحدد وين ضعفي، سؤال سؤال، وبعدها قل لي وش أركز عليه بصراحة.",
  };
  $("#ai-input").value = prompts[chip.dataset.p];
  aiSend();
};
// exam selector + date (persisted in settings)
$("#ai-exam").value = S.exam || "general";
if (S.examDate) $("#ai-examdate").value = S.examDate;
$("#ai-exam").onchange = (e) => { S.exam = e.target.value; saveS(); };
$("#ai-examdate").onchange = (e) => { S.examDate = e.target.value; saveS(); renderGreeting(); };

// ---------- ambient focus sounds (all synthesized live — no audio files) ----------
let amb = null; // {master, layers[], lfos[], timers:Set, dead}
// self-cleaning timeout: recurring schedulers would otherwise pile up thousands of dead handles per hour
function ambLater(fn, ms) {
  if (!amb || amb.dead) return;
  const a = amb;
  const id = setTimeout(() => { a.timers.delete(id); if (!a.dead) fn(); }, ms);
  a.timers.add(id);
}

function noiseBuffer(ctx, kind, secs = 3) {
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === "pink") { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25; }
    else d[i] = w;
  }
  return buf;
}
// cheap generated reverb — makes everything sound like a room instead of a buzzer
function makeReverb(ctx, secs = 2.8, decay = 2.4) {
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = ctx.createConvolver(); conv.buffer = buf; return conv;
}
function noiseLayer(ctx, out, { kind = "brown", type = "lowpass", freq = 400, q = 0.7, gain = 1 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, kind); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(out);
  src.start();
  return { src, filter: f, gain: g };
}
// slow random drift so loops never sound static
function drift(ctx, param, base, depth, rate) {
  const lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.frequency.value = rate; lg.gain.value = depth;
  param.value = base;
  lfo.connect(lg); lg.connect(param); lfo.start();
  return lfo;
}
function ping(ctx, out, { freq, dur = 0.5, vel = 0.2, type = "sine", sweep = 0 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
  if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), ctx.currentTime + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(vel, ctx.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g); g.connect(out);
  o.start(); o.stop(ctx.currentTime + dur + 0.05);
}

// ---- procedural calm piano ("روقان") — original, generated on the fly ----
const CHILL_CHORDS = [ // maj7 / min7 voicings, wide and sparse
  [53, 57, 60, 64], // Fmaj7
  [48, 52, 55, 59], // Cmaj7
  [50, 53, 57, 60], // Dm7
  [45, 48, 52, 55], // Am7
  [46, 50, 53, 57], // Bbmaj7
  [43, 47, 50, 55], // G
];
const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
function pianoNote(ctx, out, midi, at, dur, vel) {
  const f = midiHz(midi);
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
  const g = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
  o1.type = "triangle"; o1.frequency.value = f;
  o2.type = "sine"; o2.frequency.value = f * 2.002; g2.gain.value = 0.3;  // shimmer
  o3.type = "sine"; o3.frequency.value = f * 0.5; g3.gain.value = 0.18;   // body
  o1.connect(g); o2.connect(g2); g2.connect(g); o3.connect(g3); g3.connect(g);
  g.connect(out);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vel, at + 0.015);
  g.gain.exponentialRampToValueAtTime(vel * 0.35, at + 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  [o1, o2, o3].forEach(o => { o.start(at); o.stop(at + dur + 0.1); });
}
function scheduleChill(ctx, out, state) {
  if (!amb || amb.dead) return;
  const chord = CHILL_CHORDS[state.i % CHILL_CHORDS.length];
  state.i++;
  const now = ctx.currentTime + 0.05;
  const vel = 0.16;
  // sparse arpeggio, humanised timing
  chord.forEach((n, k) => {
    const at = now + k * (0.45 + Math.random() * 0.3);
    pianoNote(ctx, out, n, at, 4.2 + Math.random(), vel * (0.75 + Math.random() * 0.35));
  });
  // occasional melody note an octave up
  if (Math.random() < 0.75) {
    const n = chord[1 + Math.floor(Math.random() * 3)] + 12;
    pianoNote(ctx, out, n, now + 2.1 + Math.random() * 1.2, 3.4, vel * 0.7);
  }
  // soft bass root
  pianoNote(ctx, out, chord[0] - 12, now, 5.5, vel * 0.55);
  ambLater(() => scheduleChill(ctx, out, state), 6800 + Math.random() * 1400);
}

// ---- real audio tracks (bundled royalty-free + your own local files) ----
const BUNDLED_TRACKS = {
  stream: { src: "assets/stream.mp3", name: "جدول في غابة", by: "kvgarlic (chosic.com)" },
  surreal: { src: "assets/surreal-forest.mp3", name: "Surreal Forest", by: "Meydän (chosic.com)" },
};
// IndexedDB so your own music survives restarts (localStorage can't hold audio)
const musicDB = {
  open() {
    return new Promise((ok, no) => {
      const rq = indexedDB.open("lockin-music", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("tracks", { keyPath: "id" });
      rq.onsuccess = () => ok(rq.result);
      rq.onerror = () => no(rq.error);
    });
  },
  async all() {
    const db = await this.open();
    return new Promise((ok, no) => {
      const rq = db.transaction("tracks").objectStore("tracks").getAll();
      rq.onsuccess = () => ok(rq.result || []); rq.onerror = () => no(rq.error);
    });
  },
  async add(file) {
    const db = await this.open();
    const rec = { id: "t" + Date.now() + Math.random().toString(36).slice(2, 6), name: file.name.replace(/\.[^.]+$/, "").slice(0, 60), size: file.size, blob: file };
    return new Promise((ok, no) => {
      const rq = db.transaction("tracks", "readwrite").objectStore("tracks").add(rec);
      rq.onsuccess = () => ok(rec); rq.onerror = () => no(rq.error);
    });
  },
  async remove(id) {
    const db = await this.open();
    return new Promise((ok, no) => {
      const rq = db.transaction("tracks", "readwrite").objectStore("tracks").delete(id);
      rq.onsuccess = () => ok(); rq.onerror = () => no(rq.error);
    });
  },
};
let myTracks = [];
musicDB.all().then(t => { myTracks = t; }).catch(() => {});

// play an audio file through the ambient mixer (so volume/fade/reverb all still apply)
function trackLayer(ctx, out, url, onEnd) {
  const el = new Audio(url);
  el.loop = true; el.crossOrigin = "anonymous"; el.preload = "auto";
  const node = ctx.createMediaElementSource(el);
  const g = ctx.createGain(); g.gain.value = 1;
  node.connect(g); g.connect(out);
  el.play().catch(e => onEnd && onEnd(e));
  return { el, gain: g, isTrack: true };
}
function showNowPlaying(label) {
  const np = $("#now-playing");
  if (!label) { np.classList.add("hidden"); np.innerHTML = ""; return; }
  np.classList.remove("hidden");
  np.innerHTML = `<span class="eq"><i></i><i></i><i></i></span><span>${esc(label)}</span>`;
}

const AMB_BUILDERS = {
  rain: (ctx, out) => {
    const l = [
      noiseLayer(ctx, out, { kind: "white", type: "bandpass", freq: 1300, q: 0.45, gain: 0.75 }),
      noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 320, gain: 0.5 }),
    ];
    return { layers: l, lfos: [drift(ctx, l[0].filter.frequency, 1300, 260, 0.05)] };
  },
  storm: (ctx, out) => {
    const l = [
      noiseLayer(ctx, out, { kind: "white", type: "bandpass", freq: 1500, q: 0.4, gain: 0.8 }),
      noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 220, gain: 0.9 }),
    ];
    const boom = () => { // distant thunder
      if (!amb || amb.dead) return;
      const g = ctx.createGain(); g.connect(out);
      const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, "brown", 2.5);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 140;
      n.connect(f); f.connect(g);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.4);
      n.start(); n.stop(ctx.currentTime + 2.6);
      ambLater(boom, 14000 + Math.random() * 26000);
    };
    ambLater(boom, 6000 + Math.random() * 10000);
    return { layers: l, lfos: [drift(ctx, l[0].filter.frequency, 1500, 400, 0.07)] };
  },
  fire: (ctx, out) => {
    const l = [noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 620, gain: 0.85 })];
    const crackle = () => {
      if (!amb || amb.dead) return;
      const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, "white", 0.12);
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1200 + Math.random() * 2600; f.Q.value = 3;
      const g = ctx.createGain();
      n.connect(f); f.connect(g); g.connect(out);
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18 + Math.random() * 0.22, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + Math.random() * 0.13);
      n.start(); n.stop(t + 0.3);
      ambLater(crackle, 90 + Math.random() * 620);
    };
    crackle();
    return { layers: l, lfos: [drift(ctx, l[0].gain.gain, 0.85, 0.18, 0.11)] };
  },
  night: (ctx, out) => {
    const l = [noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 170, gain: 0.7 })];
    const cricket = () => {
      if (!amb || amb.dead) return;
      const base = 4200 + Math.random() * 900;
      for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) {
        setTimeout(() => { if (amb && !amb.dead) ping(ctx, out, { freq: base, dur: 0.045, vel: 0.05, type: "square" }); }, k * 75);
      }
      ambLater(cricket, 900 + Math.random() * 2600);
    };
    cricket();
    return { layers: l, lfos: [] };
  },
  forest: (ctx, out) => {
    const l = [noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 480, gain: 0.7 })];
    const bird = () => {
      if (!amb || amb.dead) return;
      const f = 2200 + Math.random() * 1600;
      ping(ctx, out, { freq: f, dur: 0.13, vel: 0.07, sweep: 1.45 });
      if (Math.random() < 0.6) setTimeout(() => { if (amb && !amb.dead) ping(ctx, out, { freq: f * 1.1, dur: 0.1, vel: 0.05, sweep: 1.3 }); }, 170);
      ambLater(bird, 2600 + Math.random() * 7000);
    };
    ambLater(bird, 1500);
    return { layers: l, lfos: [drift(ctx, l[0].filter.frequency, 480, 190, 0.045)] };
  },
  cafe: (ctx, out) => {
    const l = [
      noiseLayer(ctx, out, { kind: "pink", type: "lowpass", freq: 850, gain: 0.75 }),
      noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 240, gain: 0.4 }),
    ];
    const clink = () => {
      if (!amb || amb.dead) return;
      ping(ctx, out, { freq: 1900 + Math.random() * 1400, dur: 0.3, vel: 0.045, type: "triangle" });
      ambLater(clink, 4000 + Math.random() * 11000);
    };
    ambLater(clink, 3000);
    return { layers: l, lfos: [drift(ctx, l[0].gain.gain, 0.75, 0.22, 0.13)] };
  },
  waves: (ctx, out) => {
    const l = [noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 430, gain: 0.5 })];
    return { layers: l, lfos: [drift(ctx, l[0].gain.gain, 0.55, 0.45, 0.085), drift(ctx, l[0].filter.frequency, 430, 220, 0.085)] };
  },
  deep: (ctx, out) => ({ layers: [noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 250, gain: 1 })], lfos: [] }),
  chill: (ctx, out) => { // piano + soft pad bed
    const l = [noiseLayer(ctx, out, { kind: "brown", type: "lowpass", freq: 200, gain: 0.16 })];
    scheduleChill(ctx, out, { i: Math.floor(Math.random() * CHILL_CHORDS.length) });
    return { layers: l, lfos: [] };
  },
};

function startAmbient() {
  stopAmbient();
  if (S.amb === "off" || !AMB_BUILDERS[S.amb]) return;
  try {
    actx = actx || new AudioContext();
    if (actx.state === "suspended") actx.resume();
    const master = actx.createGain();
    master.gain.value = 0.0001;
    const rev = makeReverb(actx, S.amb === "chill" ? 3.4 : 2.2, S.amb === "chill" ? 2.2 : 3);
    const wet = actx.createGain(); wet.gain.value = S.amb === "chill" ? 0.42 : 0.16;
    master.connect(actx.destination);
    master.connect(wet); wet.connect(rev); rev.connect(actx.destination);
    amb = { master, timers: new Set(), layers: [], lfos: [], dead: false, kind: S.amb };
    const built = AMB_BUILDERS[S.amb](actx, master);
    amb.layers = built.layers || []; amb.lfos = built.lfos || [];
    // per-preset trim so sparse textures aren't drowned out by dense ones (measured, not guessed)
    const TRIM = { chill: 4.2, night: 1.35, forest: 1.3, cafe: 0.75, storm: 0.85 };
    const target = Math.max(0.002, 0.22 * (S.ambVol ?? 0.6) * (TRIM[S.amb] || 1));
    master.gain.exponentialRampToValueAtTime(target, actx.currentTime + 1.4);
    $$(".amb").forEach(x => x.classList.toggle("playing", x.dataset.a === S.amb));
  } catch { amb = null; }
}
function stopAmbient() {
  $$(".amb").forEach(x => x.classList.remove("playing"));
  if (!amb) return;
  const a = amb; amb = null; a.dead = true;
  a.timers.forEach(clearTimeout); a.timers.clear();
  try {
    a.master.gain.cancelScheduledValues(actx.currentTime);
    a.master.gain.setValueAtTime(Math.max(0.0002, a.master.gain.value), actx.currentTime);
    a.master.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.6);
  } catch {}
  setTimeout(() => {
    try { a.layers.forEach(l => l.src.stop()); a.lfos.forEach(l => l.stop()); a.master.disconnect(); } catch {}
  }, 800);
}
S.amb = S.amb || "off";
S.ambVol = S.ambVol ?? 0.6;
$$(".amb").forEach(b => { b.classList.toggle("active", b.dataset.a === S.amb); });
$("#amb-row").onclick = (e) => {
  const b = e.target.closest(".amb"); if (!b) return;
  const same = S.amb === b.dataset.a;
  S.amb = b.dataset.a; saveS();
  $$(".amb").forEach(x => x.classList.toggle("active", x === b));
  // preview it immediately even outside a session, so you can pick one
  if (S.amb === "off") stopAmbient();
  else if (!same || !amb) startAmbient();
};
setInterval(() => { // ambient follows the focus timer once a session is running
  if (studyingNow() && S.amb !== "off" && !amb) startAmbient();
  if (timer.kind === "break" && amb) stopAmbient();
}, 1000);

// ---------- focus lock widget (Electron only) ----------
if (window.lockin) {
  const wb = $("#btn-widget");
  wb.classList.remove("hidden");
  wb.onclick = async () => {
    const open = await window.lockin.toggleWidget();
    wb.classList.toggle("pop-cyan", open);
    toast(open ? "Widget pinned on top — drag it anywhere" : "Widget closed");
  };
  window.lockin.onWidgetClosed(() => wb.classList.remove("pop-cyan"));
}
setInterval(() => {
  const g = state?.groups.find(x => x.code === curGroup);
  localStorage.setItem("widgetState", JSON.stringify({
    running: timer.running, kind: timer.kind, mode: timer.mode,
    startAt: timer.startAt, pausedElapsed: timer.pausedElapsed,
    activity: actName(), liveN: g ? g.members.filter(isLive).length : (studyingNow() ? 1 : 0),
  }));
}, 1000);

// ---------- coin shop ----------
const SHOP = {
  frame: [["gold", 300], ["neon", 500], ["fire", 800], ["rainbow", 1200]],
  flair: [["EARLY BIRD", 200], ["NIGHT OWL", 200], ["GRINDER", 400], ["LOCKED IN", 600]],
  theme: [["ocean", 1000], ["sunset", 1000]],
};
const THEME_DOT = { ocean: "linear-gradient(135deg,#38bdf8,#0c4a6e)", sunset: "linear-gradient(135deg,#fb7185,#f59e0b)" };
function shopBody() {
  const me = state.me, owned = me.owned || [];
  const item = (slot, name, price) => {
    const key = slot + ":" + name;
    const has = owned.includes(key);
    const eq = (slot === "frame" && me.frame === name) || (slot === "flair" && me.flair === name) || (slot === "theme" && me.theme === name);
    const preview = slot === "frame" ? av({ ...me, frame: name }, "av-sm") : slot === "theme" ? `<span class="theme-dot" style="background:${THEME_DOT[name]}"></span>` : `<span class="flair-chip">${esc(name)}</span>`;
    return `<div class="shop-item ${has ? "owned" : ""} ${eq ? "equipped" : ""}" data-slot="${slot}" data-item="${esc(name)}">
      ${preview}<span class="sname">${esc(name.toLowerCase())}</span>
      ${eq ? `<span class="sstate">ON</span>` : has ? `<span class="sstate" style="color:var(--muted)">USE</span>` : `<span class="sprice"><svg class="ic ic-coin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" class="coin-txt">¢</text></svg>${price}</span>`}
    </div>`;
  };
  return `<div class="shop-coins"><svg class="ic ic-coin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" class="coin-txt">¢</text></svg> ${me.coins.toLocaleString()}</div>
    <div class="shop-sec">AVATAR FRAMES</div><div class="shop-grid">${SHOP.frame.map(([n, p]) => item("frame", n, p)).join("")}</div>
    <div class="shop-sec">NAME FLAIR</div><div class="shop-grid">${SHOP.flair.map(([n, p]) => item("flair", n, p)).join("")}</div>
    <div class="shop-sec">APP THEMES</div><div class="shop-grid">${SHOP.theme.map(([n, p]) => item("theme", n, p)).join("")}</div>
    <div class="shop-sec">BOOSTS</div>
    <div class="shop-item" id="shop-freeze"><svg class="ic" viewBox="0 0 24 24" style="fill:var(--c-cyan)"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z"/></svg>
      <span class="sname">streak freeze ${me.freezes > 0 ? `(held ×${me.freezes})` : ""}</span>
      <span class="sprice">${COIN_SVG}400</span></div>
    <p class="hint">Freeze auto-saves your streak if you miss a day (max 2 held). Tap to buy · tap items to equip/unequip. Friends see your frame and flair.</p>`;
}
$("#btn-shop").onclick = () => {
  if (!state) return;
  modal("Coin shop", shopBody(), async () => {}, "Done");
  $("#modal-body").onclick = async (e) => {
    if (e.target.closest("#shop-freeze")) {
      try {
        const r = await api("/api/shop/freeze", {});
        sfx.coin(); toast(`Streak freeze bought — holding ×${r.freezes}`);
        await refresh(); $("#modal-body").innerHTML = shopBody();
      } catch (err) { sfx.error(); toast(err.message); }
      return;
    }
    const it = e.target.closest(".shop-item"); if (!it) return;
    const { slot, item } = it.dataset;
    if (!slot) return;
    const me = state.me, key = slot + ":" + item;
    try {
      if (!(me.owned || []).includes(key)) {
        await api("/api/shop/buy", { slot, item });
        sfx.coin(); confetti(); toast(`Unlocked ${item.toLowerCase()}!`);
      } else {
        const eq = (slot === "frame" && me.frame === item) || (slot === "flair" && me.flair === item) || (slot === "theme" && me.theme === item);
        await api("/api/shop/equip", { slot, item: eq ? "" : item });
        sfx.click();
      }
      await refresh();
      $("#modal-body").innerHTML = shopBody();
    } catch (err) { sfx.error(); toast(err.message); }
  };
};

// ---------- squad chat ----------
let chatCount = -1;
function renderSquadChat(g) {
  const list = $("#chat-list");
  if (!g) { list.innerHTML = `<div class="empty"><span>Join a group to chat</span></div>`; chatCount = -1; return; }
  const msgs = g.msgs || [];
  if (msgs.length === chatCount) return; // no re-render (protects input focus + scroll)
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const newArrived = chatCount >= 0 && msgs.length > chatCount;
  chatCount = msgs.length;
  list.innerHTML = msgs.length ? msgs.map(m => `
    <div class="chat-msg ${m.uid === cfg.userId ? "mine" : ""}">
      ${av(m, "av-sm")}
      <div class="cbody" dir="auto"><div class="cname">${esc(m.name)}</div>${esc(m.text)}<div class="ctime">${new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div></div>
    </div>`).join("") : `<div class="empty"><span>No messages yet — say hi</span></div>`;
  if (nearBottom || chatCount <= msgs.length) list.scrollTop = list.scrollHeight;
  if (newArrived && msgs[msgs.length - 1].uid !== cfg.userId) sfx.click();
  settle(list.parentElement);
}
async function sendChat() {
  const inp = $("#chat-input");
  const text = inp.value.trim();
  if (!text || !curGroup) return;
  inp.value = "";
  try { await api("/api/chat", { groupCode: curGroup, text }); refresh(); }
  catch (e) { sfx.error(); toast(e.message); inp.value = text; }
}
$("#chat-send").onclick = sendChat;
$("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

// ---------- daily quests ----------
const COIN_SVG = `<svg class="ic ic-coin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" class="coin-txt">¢</text></svg>`;
function renderQuests(me) {
  const qs = me.quests || [];
  $("#quest-list").innerHTML = qs.map(q => `
    <div class="quest ${q.done ? "qdone" : ""}">
      <div class="qmid">
        <div class="qtitle">${esc(q.title)}</div>
        <div class="qbar"><i style="width:${Math.min(100, q.progress / q.target * 100).toFixed(0)}%"></i></div>
      </div>
      ${q.claimed ? `<span class="qdone-tag">DONE</span>`
        : q.done ? `<button class="qclaim" data-q="${q.id}">CLAIM +${q.reward}</button>`
        : `<span class="qreward">${COIN_SVG}${q.reward}</span>`}
    </div>`).join("");
}
$("#quest-list").addEventListener("click", async (e) => {
  const b = e.target.closest(".qclaim"); if (!b) return;
  b.disabled = true;
  try {
    const r = await api("/api/quest/claim", { id: Number(b.dataset.q) });
    sfx.coin(); confetti(); toast(`Quest complete! +${r.reward} coins`);
    refresh();
  } catch (err) { sfx.error(); toast(err.message); b.disabled = false; }
});

// ---------- group focus room (synced pomodoro) ----------
let roomJoinedAt = 0;
function renderRoom(g) {
  const box = $("#room-box");
  const room = g?.room;
  if (!room) {
    box.innerHTML = g && g.members.length > 1 ? `<button class="btn small pop-pink room-start" id="room-start-btn">START GROUP FOCUS</button>` : "";
    return;
  }
  const left = Math.max(0, room.mode - (Date.now() - room.startAt) / 1000);
  const joined = timer.running && Math.abs(roomJoinedAt - room.startAt) < 1000;
  box.innerHTML = `<div class="room-banner">
    <div class="rtop"><span class="live-dot"></span> GROUP FOCUS · <span class="rtime">${fmtClock(left)}</span></div>
    <div class="rsub">${esc(room.byName)} started a ${Math.round(room.mode / 60)}m session — study together</div>
    ${joined ? `<div class="rsub" style="color:var(--go);margin:0">You're in. Lock in.</div>` : `<button class="btn candy" id="room-join-btn">JOIN NOW</button>`}
  </div>`;
}
$("#room-box").addEventListener("click", async (e) => {
  if (e.target.closest("#room-start-btn")) {
    modal("Group focus session", `
      <p class="muted">Everyone in the group gets a JOIN button and your timers tick down together.</p>
      <label>Minutes</label><input type="number" id="m-roommin" min="5" max="180" value="25">`,
      async () => {
        try {
          await api("/api/room/start", { groupCode: curGroup, minutes: Number($("#m-roommin").value) });
          await refresh();
          $("#room-join-btn")?.click();
          toast("Group session started — squad has been signaled");
        } catch (err) { sfx.error(); toast(err.message); return false; }
      }, "Start");
  }
  if (e.target.closest("#room-join-btn")) {
    const room = state?.groups.find(x => x.code === curGroup)?.room;
    if (!room) return;
    const left = Math.max(60, Math.round(room.mode - (Date.now() - room.startAt) / 1000));
    if (timer.running || elapsed() > 0) { if (!confirm("Discard your current session and join the group?")) return; }
    stopTicking();
    setKindSilent("focus");
    timer.mode = left;
    roomJoinedAt = room.startAt;
    startTicking();
    sfx.start(); sendPresence();
    toast("Joined — finishing together with the squad");
  }
});

// ---------- nudges ----------
$("#board").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-nudge]"); if (!b) return;
  try { await api("/api/nudge", { toId: b.dataset.nudge }); sfx.click(); toast("Nudge sent 👉"); }
  catch (err) { sfx.error(); toast(err.message); }
});
function deliverNudges(me) {
  (me.nudges || []).forEach((n, i) => {
    setTimeout(() => {
      toast(`👉 ${n.from} nudged you: get back to work!`, 5000);
      sfx.complete(); notify("Nudge!", `${n.from} says: get back to work`);
    }, i * 1200);
  });
}

// ---------- stats deep-dive ----------
$("#btn-stats").onclick = () => {
  const me = state?.me; if (!me) return;
  const d90 = me.days90 || [];
  const max90 = Math.max(...d90, 1);
  const heat = d90.map(s => `<i class="${s === 0 ? "" : s < max90 * 0.25 ? "h1" : s < max90 * 0.5 ? "h2" : s < max90 * 0.75 ? "h3" : "h4"}" title="${fmtHM(s)}"></i>`).join("");
  const subjMax = Math.max(...(me.subjects || []).map(s => s[1]), 1);
  const subj = (me.subjects || []).map(([n, s]) => `<div class="subj-row"><span class="sname">${esc(n)}</span><div class="sbar"><i style="width:${(s / subjMax * 100).toFixed(0)}%"></i></div><span class="sval">${fmtHM(s)}</span></div>`).join("") || `<p class="hint">Type what you're studying before sessions to see subjects here.</p>`;
  const hrMax = Math.max(...(me.hours || [1]), 1);
  const hours = (me.hours || Array(24).fill(0)).map((s, h) => `<i style="height:${Math.max(4, s / hrMax * 100)}%" title="${h}:00 — ${fmtHM(s)}"></i>`).join("");
  modal("Your stats", `
    <div class="shop-sec">LAST 90 DAYS</div><div class="heatmap">${heat}</div>
    <div class="shop-sec">BY SUBJECT</div>${subj}
    <div class="shop-sec">WHEN YOU STUDY</div><div class="hourbars">${hours}</div>
    <div class="hourlabels"><span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>11PM</span></div>
    <div class="rec-grid">
      <div class="rec-item"><b>${fmtHM(Math.max(...(me.days || [0])))}</b><span>best day</span></div>
      <div class="rec-item"><b>${fmtHM(me.maxSession || 0)}</b><span>longest session</span></div>
      <div class="rec-item"><b>${fmtHM(me.totalSeconds)}</b><span>all time</span></div>
      <div class="rec-item"><b>${me.streak}</b><span>streak</span></div>
    </div>`, async () => {}, "Close");
};

// ---------- mock exam engine (PDF/photo → test → predicted score → remembered) ----------
const readFile = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
const EXAM_NAMES = { "general": "عام", "qudurat-cbt": "قدرات محوسب", "qudurat-paper": "قدرات ورقي", "tahsili": "تحصيلي", "tahsili-early": "تحصيلي مبكر", "step": "STEP" };
const AR_LETTER = ["أ", "ب", "ج", "د"];
let ex = null; // {questions,title,answers,cur,startAt,tickH,graded}

$("#ai-chips-doc").onclick = (e) => {
  const b = e.target.closest(".ai-chip"); if (!b) return;
  if (b.dataset.d === "test") $("#ai-file").click();
  if (b.dataset.d === "photo") $("#ai-photo").click();
  if (b.dataset.d === "history") showExamHistory();
  if (b.dataset.d === "library") showLibrary();
};
$("#lib-file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  toast("يقرأ الملف…", 30000);
  try {
    await api("/api/library/add", { file: await readFile(f), filename: f.name });
    $("#toast").classList.add("hidden");
    sfx.coin(); toast("انضاف للمكتبة");
    await refresh(); showLibrary();
  } catch (err) { sfx.error(); toast(err.message, 5000); }
};

$("#ai-file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const dataUrl = await readFile(f);
  modal("اختبار من ملفك", `
    <p class="muted">راح يقرأ <b>${esc(f.name)}</b> ويولّد منه اختبار بمستوى الاختبار الحقيقي، وبعد ما تخلص يعطيك درجة متوقعة ويحفظها في سجلك.</p>
    <label>عدد الأسئلة</label><input type="number" id="m-qn" min="3" max="20" value="10">
    <label>الوقت (دقيقة، 0 = بدون وقت)</label><input type="number" id="m-qt" min="0" max="180" value="0">
    <div class="upl-note"><svg class="ic ic-xs" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/></svg> التوليد يأخذ من 10 لـ 40 ثانية</div>`,
    async () => {
      const count = Number($("#m-qn").value) || 10, mins = Number($("#m-qt").value) || 0;
      closeModal();
      await buildExam({ file: dataUrl, filename: f.name, count, mins, title: f.name.replace(/\.[^.]+$/, "") });
      return false;
    }, "ولّد الاختبار");
};

$("#ai-photo").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const img = await readFile(f);
  $("#ai-panel").classList.remove("hidden");
  savedView = false;
  aiChat.push({ role: "user", content: "📷 " + f.name }); saveChat(); renderChat();
  const box = $("#ai-msgs");
  box.insertAdjacentHTML("beforeend", `<div class="ai-msg bot thinking" id="ai-think"><i></i><i></i><i></i></div>`);
  box.scrollTop = box.scrollHeight;
  aiBusy = true;
  try {
    const r = await api("/api/ai/vision", { image: img, note: `الاختبار: ${EXAM_NAMES[S.exam] || "عام"}.` });
    aiChat.push({ role: "assistant", content: r.reply, model: r.model }); saveChat(); sfx.click();
  } catch (err) { aiChat.push({ role: "assistant", content: "⚠ " + err.message }); sfx.error(); }
  aiBusy = false; renderChat();
};

async function buildExam({ file, filename, topic, count, mins, title, libId }) {
  toast("يولّد الاختبار… خذ نفس", 30000);
  try {
    const r = await api("/api/exam/generate", { file, filename, topic, count, exam: S.exam || "general", title, libId });
    $("#toast").classList.add("hidden");
    startExam(r.questions, r.title || title, mins);
  } catch (e) { sfx.error(); toast("ما قدر يولّد: " + e.message, 5000); }
}

function startExam(questions, title, mins) {
  ex = { questions, title, answers: Array(questions.length).fill(-1), cur: 0, graded: false, endAt: mins ? Date.now() + mins * 60000 : 0 };
  $("#exam-title").textContent = title;
  $("#exam").classList.remove("hidden");
  $("#exam-quit").onclick = () => {
    if (!ex.graded && !confirm("تطلع من الاختبار؟ إجاباتك بتضيع.")) return;
    endExam();
  };
  ex.tickH = setInterval(examTick, 500);
  renderExamQ();
  examTick();
}
function endExam() {
  clearInterval(ex?.tickH);
  $("#exam").classList.add("hidden");
  ex = null;
}
function examTick() {
  if (!ex) return;
  const t = $("#exam-timer");
  if (!ex.endAt || ex.graded) { t.textContent = ""; return; }
  const left = Math.max(0, (ex.endAt - Date.now()) / 1000);
  t.textContent = fmtClock(left);
  t.classList.toggle("low", left < 60);
  if (left <= 0) { toast("انتهى الوقت"); submitExam(); }
}
function renderExamQ() {
  const q = ex.questions[ex.cur];
  const picked = ex.answers[ex.cur];
  const showAns = ex.graded;
  $("#exam-count").textContent = `${ex.cur + 1} / ${ex.questions.length}`;
  $("#exam-prog").style.width = ((ex.cur + 1) / ex.questions.length * 100) + "%";
  $("#exam-body").innerHTML = `
    ${q.topic ? `<span class="exam-topic">${esc(q.topic)}</span>` : ""}
    <div class="exam-q" dir="auto">${esc(q.q)}</div>
    <div class="exam-choices">
      ${q.choices.map((c, i) => {
        let cls = "";
        if (showAns) cls = i === q.answer ? "ok" : (i === picked ? "bad" : "");
        else if (i === picked) cls = "sel";
        return `<button class="exam-choice ${cls}" data-c="${i}" dir="auto"><span class="ck">${AR_LETTER[i] || i + 1}</span><span>${esc(c)}</span></button>`;
      }).join("")}
    </div>
    ${showAns && q.why ? `<div class="exam-why" dir="auto"><b>${picked === q.answer ? "صح" : "غلط"}</b> — ${esc(q.why)}</div>` : ""}`;
  $("#exam-dots").innerHTML = ex.questions.map((_, i) =>
    `<i class="${i === ex.cur ? "cur" : ex.answers[i] >= 0 ? "done" : ""}" data-g="${i}"></i>`).join("");
  $("#exam-prev").disabled = ex.cur === 0;
  const last = ex.cur === ex.questions.length - 1;
  $("#exam-next").textContent = ex.graded ? (last ? "إغلاق" : "التالي") : (last ? "سلّم" : "التالي");
}
$("#exam-body").addEventListener("click", (e) => {
  const c = e.target.closest(".exam-choice"); if (!c || !ex || ex.graded) return;
  ex.answers[ex.cur] = Number(c.dataset.c);
  sfx.click();
  renderExamQ();
  if (ex.cur < ex.questions.length - 1) setTimeout(() => { ex.cur++; renderExamQ(); }, 220);
});
$("#exam-dots").addEventListener("click", (e) => {
  const d = e.target.closest("[data-g]"); if (!d || !ex) return;
  ex.cur = Number(d.dataset.g); renderExamQ();
});
$("#exam-prev").onclick = () => { if (ex && ex.cur > 0) { ex.cur--; renderExamQ(); } };
$("#exam-next").onclick = () => {
  if (!ex) return;
  const last = ex.cur === ex.questions.length - 1;
  if (!last) { ex.cur++; renderExamQ(); return; }
  if (ex.graded) { endExam(); return; }
  submitExam();
};

async function submitExam() {
  if (!ex || ex.graded) return;
  const unanswered = ex.answers.filter(a => a < 0).length;
  if (unanswered && !confirm(`باقي ${unanswered} سؤال بدون جواب. تسلّم؟`)) return;
  ex.graded = true;
  clearInterval(ex.tickH);
  const btn = $("#exam-next"); btn.classList.add("loading");
  try {
    const r = await api("/api/exam/submit", { questions: ex.questions, answers: ex.answers, title: ex.title, exam: S.exam || "general" });
    btn.classList.remove("loading");
    showExamResult(r);
  } catch (e) { btn.classList.remove("loading"); sfx.error(); toast(e.message); ex.graded = false; }
}

function showExamResult(r) {
  const pct = Math.round(r.correct / r.total * 100);
  const delta = r.prev !== null ? r.score - r.prev : null;
  const C = 2 * Math.PI * 52;
  // prefer cumulative mastery; on early exams fall back to this attempt's own topic split
  const usingCumulative = !!r.weak?.length;
  const topicRows = usingCumulative ? r.weak
    : (r.topics || []).map(t => ({ topic: t.t, pct: Math.round(t.c / t.n * 100) })).sort((a, b) => a.pct - b.pct);
  modal("نتيجتك", `
    <svg class="res-ring" width="130" height="130" viewBox="0 0 130 130">
      <circle cx="65" cy="65" r="52" fill="none" stroke="var(--bg2)" stroke-width="11"/>
      <circle cx="65" cy="65" r="52" fill="none" stroke="url(#ringGrad)" stroke-width="11" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 65 65)" id="res-arc"/>
    </svg>
    <div class="res-lab">الدرجة المتوقعة</div>
    <div class="res-score" id="res-num">0</div>
    <div class="res-sub">${r.correct} من ${r.total} صح · ${pct}%</div>
    ${delta !== null ? `<div class="res-delta ${delta >= 0 ? "recap-up" : "recap-down"}">${delta >= 0 ? "▲ +" : "▼ "}${delta} عن اختبارك السابق</div>` : `<div class="res-delta muted">أول اختبار — هذي نقطة البداية</div>`}
    ${topicRows.length ? `<div class="shop-sec">${usingCumulative ? "إتقانك حسب الموضوع" : "أداؤك في هذا الاختبار"}</div>${topicRows.map(w => `
      <div class="weak-row ${w.pct >= 70 ? "good" : ""}"><span class="wname">${esc(w.topic)}</span><div class="wbar"><i style="width:${w.pct}%"></i></div><span class="wpct">${w.pct}%</span></div>`).join("")}` : ""}
    <p class="hint">الدرجة تقدير تقريبي من دقتك + ساعات مذاكرتك، مو درجة رسمية من قياس. المساعد يتذكر هذا الاختبار ويبني عليه.</p>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn ghost" id="res-review">راجع أخطائي</button>
      <button class="btn candy" id="res-plan">وش أذاكر الحين؟</button>
    </div>`, async () => { endExam(); }, "تمام");
  // animate ring + number (setTimeout, not rAF — rAF is frozen in background windows)
  setTimeout(() => {
    const arc = $("#res-arc"); if (arc) { arc.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)"; arc.style.strokeDashoffset = C * (1 - r.score / 100); }
    const n = $("#res-num"); if (n) countUp(n, r.score);
  }, 60);
  if (r.score >= 75 || (delta !== null && delta > 0)) { confetti(); sfx.complete(); } else sfx.coin();
  $("#res-review").onclick = () => { closeModal(); ex.cur = 0; renderExamQ(); };
  $("#res-plan").onclick = () => {
    closeModal(); endExam();
    $("#ai-panel").classList.remove("hidden"); savedView = false;
    $("#ai-input").value = `خلصت اختبار "${r.title}" وجبت ${r.score}/100 (${r.correct} من ${r.total}). أضعف مواضيعي: ${(r.weak || []).slice(0, 3).map(w => `${w.topic} ${w.pct}%`).join("، ") || "—"}. وش أذاكر الحين بالضبط؟`;
    aiSend();
  };
}

function showExamHistory() {
  const me = state?.me; if (!me) return;
  const exs = [...(me.exams || [])].reverse();
  const weak = me.weakTopics || [];
  modal("سجل اختباراتي", exs.length ? `
    ${exs.length >= 2 ? `<div class="res-sub">من ${exs[exs.length - 1].score} إلى <b>${exs[0].score}</b> عبر ${exs.length} اختبار</div>` : ""}
    <div class="shop-sec">الاختبارات</div>
    ${exs.map(e => `<div class="hist-row">
      <div style="min-width:0;flex:1"><div class="hname">${esc(e.title)}</div><div class="hdate">${new Date(e.at).toLocaleDateString()} · ${e.correct}/${e.total}</div></div>
      <span class="hscore" style="color:${e.score >= 75 ? "var(--go)" : e.score >= 50 ? "var(--c-yellow)" : "var(--c-orange)"}">${e.score}</span>
    </div>`).join("")}
    ${weak.length ? `<div class="shop-sec">إتقانك التراكمي</div>${weak.map(w => `
      <div class="weak-row ${w.pct >= 70 ? "good" : ""}"><span class="wname">${esc(w.topic)}</span><div class="wbar"><i style="width:${w.pct}%"></i></div><span class="wpct">${w.pct}%</span></div>`).join("")}` : ""}
    <p class="hint">المساعد يتذكر كل هذي الاختبارات ويستشهد فيها لما تسأله.</p>`
    : `<div class="empty">${EMPTY_RING}<span>ما سويت اختبار بعد — ارفع ملف PDF وولّد أول اختبار.</span></div>`,
    async () => {}, "إغلاق");
}

// ---------- exam-day war room ----------
function renderWarRoom(me) {
  const d = examDaysLeft();
  const wr = $("#warroom");
  if (!d || d > 30) { wr.classList.add("hidden"); document.body.classList.remove("wr-critical"); return; }
  wr.classList.remove("hidden");
  document.body.classList.toggle("wr-critical", d <= 7);
  $("#wr-days").textContent = d;
  // intensity: daily target ramps as the exam closes
  const mult = d <= 3 ? 2 : d <= 7 ? 1.7 : d <= 14 ? 1.4 : 1.15;
  const target = Math.round(S.goal * mult);
  const done = Math.floor(withLive(me, me.today) / 60);
  $("#wr-bar-fill").style.width = Math.min(100, done / target * 100) + "%";
  const left = Math.max(0, target - done);
  const msg = d <= 3
    ? (left ? `وضع الطوارئ: ${fmtHM(left * 60)} باقية من هدف اليوم المكثّف (${fmtHM(target * 60)})` : "أنجزت هدف اليوم المكثّف. أي دقيقة زيادة ربح.")
    : d <= 7
      ? (left ? `الأسبوع الأخير: هدفك اليوم ${fmtHM(target * 60)} — باقي ${fmtHM(left * 60)}` : "هدف الأسبوع الأخير مكتمل اليوم. ممتاز.")
      : (left ? `تكثيف: هدف اليوم ${fmtHM(target * 60)} — باقي ${fmtHM(left * 60)}` : "هدف اليوم مكتمل.");
  $("#wr-msg").textContent = msg;
}
$("#wr-plan").onclick = () => {
  const d = examDaysLeft();
  $("#ai-panel").classList.remove("hidden"); savedView = false;
  const weak = (state?.me?.weakTopics || []).slice(0, 3).map(w => `${w.topic} ${w.pct}%`).join("، ");
  $("#ai-input").value = `باقي ${d} يوم على اختباري.${weak ? ` أضعف مواضيعي: ${weak}.` : ""} اعطني خطة طوارئ يوم بيوم للمدة المتبقية — محددة بالساعات والمواضيع، بدون كلام عام.`;
  aiSend();
};

// ---------- AI coach: assigns your next session ----------
$("#btn-coach").onclick = async () => {
  const b = $("#btn-coach"); b.classList.add("loading");
  try {
    const r = await api("/api/coach/assign", { daysLeft: examDaysLeft(), goalMin: S.goal, exam: S.exam || "general" });
    $("#coach-card").classList.remove("hidden");
    $("#coach-card").innerHTML = `
      <div class="coach-top"><span class="coach-min">${r.minutes}m</span><span class="coach-focus">${esc(r.focus)}</span></div>
      <div class="coach-why">${esc(r.why)}${r.urgency ? " " + esc(r.urgency) : ""}</div>
      <div class="coach-acts">
        <button class="btn candy" id="coach-go">ابدأ الجلسة</button>
        ${r.hasData ? `<button class="btn ghost" id="coach-drill">درّبني عليه</button>` : `<button class="btn ghost" id="coach-test">سوّ اختبار</button>`}
      </div>`;
    $("#coach-go").onclick = () => {
      if (timer.running || elapsed() > 0) { if (!confirm("تلغي الجلسة الحالية؟")) return; }
      stopTicking(); setKindSilent("focus");
      timer.mode = r.minutes * 60;
      $("#activity").value = r.focus;
      resetTimerUI(); startTicking(); sfx.start(); sendPresence();
      $("#coach-card").classList.add("hidden");
      toast(`الكوتش شغّل ${r.minutes} دقيقة على ${r.focus}`);
    };
    $("#coach-drill") && ($("#coach-drill").onclick = () => {
      $("#ai-panel").classList.remove("hidden"); savedView = false;
      $("#ai-input").value = `درّبني بأسئلة على ${r.focus} — سؤال سؤال بمستوى الاختبار، وانتظر جوابي.`;
      aiSend();
    });
    $("#coach-test") && ($("#coach-test").onclick = () => { $("#ai-file").click(); });
  } catch (e) { sfx.error(); toast(e.message); }
  b.classList.remove("loading");
};

// ---------- voice mode ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const isDesktop = !!window.lockin; // Electron build
let recog = null, listening = false, srDead = false;
$("#ai-mic").onclick = () => {
  if (!SR || srDead) return voiceUnavailable();
  if (listening) { recog?.stop(); return; }
  recog = new SR();
  recog.lang = S.voiceLang === "en" ? "en-US" : "ar-SA";
  recog.interimResults = true;
  recog.continuous = false;
  let heard = false;
  recog.onstart = () => { listening = true; $("#ai-mic").classList.add("on"); toast("اسمعك… تكلم"); };
  recog.onresult = (e) => {
    heard = true;
    let txt = "";
    for (const r of e.results) txt += r[0].transcript;
    $("#ai-input").value = txt;
  };
  recog.onerror = (e) => {
    // Electron has no Google speech key: always fails with "network"/"service-not-allowed"
    if (["network", "service-not-allowed", "not-allowed", "audio-capture"].includes(e.error)) {
      srDead = e.error === "network" || e.error === "service-not-allowed";
      voiceUnavailable(e.error);
    } else toast("ما قدرت أسمع: " + e.error);
  };
  recog.onend = () => {
    listening = false; $("#ai-mic").classList.remove("on");
    if (heard && $("#ai-input").value.trim()) aiSend();
  };
  try { recog.start(); } catch { toast("المايك مشغول"); }
};
function voiceUnavailable(err) {
  const url = cfg.server || "";
  if (isDesktop) {
    modal("الإدخال الصوتي", `
      <p class="muted">التعرّف على الصوت يحتاج خدمة قوقل المدمجة في المتصفح، وما تجي مع نسخة الديسكتوب — هذا قيد في Electron نفسه، مو في التطبيق.</p>
      <p class="hint" style="margin-top:10px">الحل: افتح نفس التطبيق في متصفح Chrome أو Edge — نفس حسابك ونفس بياناتك بالضبط، والمايك يشتغل هناك.</p>
      ${url ? `<div class="code-display" style="font-size:15px;letter-spacing:0;word-break:break-all">${esc(url)}</div>` : ""}
      <p class="hint">قراءة الردود بصوت (زر السماعة) تشتغل عادي هنا في الديسكتوب.</p>`,
      async () => { if (url) { try { await navigator.clipboard.writeText(url); toast("انتسخ الرابط"); } catch {} } }, url ? "انسخ الرابط" : "تمام");
  } else {
    toast(err === "not-allowed" ? "لازم تسمح للمايك من إعدادات المتصفح" : "المتصفح ما يدعم التعرف على الصوت");
  }
}
S.speak = S.speak || false;
$("#ai-speak").classList.toggle("on", !!S.speak);
$("#ai-speak").onclick = () => {
  S.speak = !S.speak; saveS();
  $("#ai-speak").classList.toggle("on", S.speak);
  if (!S.speak) speechSynthesis.cancel();
  toast(S.speak ? "بيقرأ الردود بصوت" : "وقّف القراءة الصوتية");
};
function speakReply(text) {
  if (!S.speak || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const clean = String(text).replace(/[*`#_>-]/g, " ").slice(0, 700);
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = /[؀-ۿ]/.test(clean) ? "ar-SA" : "en-US";
    utt.rate = 1.02;
    speechSynthesis.speak(utt);
  } catch {}
}

// ---------- AI rival ----------
$("#btn-rival").onclick = () => {
  const r = state?.me?.rival;
  const pace = Number(localStorage.getItem("rivalPace") || 3);
  modal(r ? "خصمك" : "أضف خصم افتراضي", r ? `
    <div class="pf-head">${av(r, "av-xl")}<div class="coach-focus">${esc(r.name)}</div></div>
    <div class="res-sub">يذاكر ${pace} ساعة يومياً · اليوم ${fmtHM(r.today)} · الأسبوع ${fmtHM(r.week)}</div>
    <label>غيّر وتيرته (ساعات باليوم)</label><input type="number" id="m-rp" min="0.5" max="12" step="0.5" value="${pace}">
    <p class="hint">الخصم يظهر معك في اللوحة وينافسك على الساعات — ما يشوفه أصحابك، خاص فيك.</p>
    <div class="modal-actions" style="margin-top:14px"><button class="btn ghost" id="rival-off">شيله</button></div>`
    : `
    <p class="muted">بوت يذاكر بوتيرة ثابتة كل يوم ويظهر معك في اللوحة — يخليك تسابق حتى لو أصحابك ما دخلوا.</p>
    <label>اسمه (اختياري)</label><input id="m-rname" placeholder="الغريم" maxlength="20">
    <label>وتيرته (ساعات باليوم)</label><input type="number" id="m-rp" min="0.5" max="12" step="0.5" value="3">
    <p class="hint">اختر وتيرة تتحداك شوي — لو حطيت رقم كبير بيسحقك ويحبطك.</p>`,
    async () => {
      const p = Math.max(0.5, Math.min(12, Number($("#m-rp").value) || 3));
      localStorage.setItem("rivalPace", String(p));
      try {
        await api("/api/rival", { pace: p, name: $("#m-rname")?.value || "" });
        await refresh();
        toast(state?.me?.rival ? `${state.me.rival.name} دخل السباق` : "تم");
        sfx.coin();
      } catch (e) { sfx.error(); toast(e.message); return false; }
    }, r ? "حفظ" : "أضفه");
  const off = $("#rival-off");
  if (off) off.onclick = async () => {
    try { await api("/api/rival", { off: true }); await refresh(); closeModal(); toast("شلت الخصم"); }
    catch (e) { toast(e.message); }
  };
};

// ---------- natural-language app control ----------
// NOTE: \b is ASCII-only in JS regex — it never matches after Arabic letters. Use an explicit space/end lookahead.
const ACTION_WORDS = /^\s*(?:\/|ابدأ|ابدا|شغّل|شغل|سوّ|سوي|اعمل|سوّي|افتح|وقف|وقّف|ورني|ورّني|أرني|خلّ|خل|حط|ابغى|أبغى|ودّي|start|open|show|make|create|stop|begin|launch|run|give me)(?=\s|$)/i;
async function tryCommand(text) {
  if (!ACTION_WORDS.test(text.trim())) return false;
  let c;
  try { c = await api("/api/ai/command", { text }); } catch { return false; }
  if (!c.action || c.action === "chat" || c.action === "none") return false;
  const p = c.params || {};
  const done = (msg) => { toast(msg || c.say || "تم"); sfx.click(); return true; };
  switch (c.action) {
    case "start_timer": {
      if (timer.running || elapsed() > 0) { if (!confirm("تلغي الجلسة الحالية؟")) return true; }
      stopTicking(); setKindSilent("focus");
      timer.mode = Math.max(1, Math.min(300, Number(p.minutes) || 25)) * 60;
      if (p.activity) $("#activity").value = String(p.activity).slice(0, 32);
      resetTimerUI(); startTicking(); sfx.start(); sendPresence();
      return done(c.say || `شغّلت ${timer.mode / 60} دقيقة`);
    }
    case "start_break": {
      stopTicking(); setKindSilent("break");
      timer.mode = Math.max(1, Math.min(60, Number(p.minutes) || 5)) * 60;
      resetTimerUI(); startTicking(); sfx.start();
      return done(c.say || "بريك");
    }
    case "stop_timer":
      if (timer.running || elapsed() > 0) finishSession(false);
      return done(c.say || "وقّفت");
    case "create_challenge": {
      if (!curGroup) return done("لازم قروب أول");
      try {
        await api("/api/challenge", { groupCode: curGroup, type: ["race", "team", "solo", "streak"].includes(p.type) ? p.type : "race", title: String(p.title || "تحدي").slice(0, 48), target: Math.max(1, Math.min(1000, Number(p.target) || 10)) });
        refresh();
      } catch (e) { toast(e.message); }
      return done(c.say || "أنشأت التحدي");
    }
    case "group_focus": {
      if (!curGroup) return done("لازم قروب أول");
      try { await api("/api/room/start", { groupCode: curGroup, minutes: Math.max(5, Math.min(180, Number(p.minutes) || 25)) }); await refresh(); $("#room-join-btn")?.click(); }
      catch (e) { toast(e.message); }
      return done(c.say || "بدأت جلسة جماعية");
    }
    case "start_quiz": startQuiz(Number(p.count) || 6, String(p.topic || "")); return done(c.say || "يجهّز التحدي");
    case "generate_test": buildExam({ topic: String(p.topic || "") || (S.exam || "عام"), count: Math.max(3, Math.min(20, Number(p.count) || 10)), mins: 0, title: String(p.topic || "اختبار سريع") }); return done(c.say || "يولّد اختبار");
    case "show_stats": $("#btn-stats").click(); return done(c.say || "");
    case "show_shop": $("#btn-shop").click(); return done(c.say || "");
    case "show_history": showExamHistory(); return done(c.say || "");
    case "show_quests": $("#tile-timer").scrollIntoView({ behavior: "smooth" }); return done(c.say || "مهامك تحت المؤقت");
    case "nudge": {
      const g = state?.groups.find(x => x.code === curGroup);
      const m = g?.members.find(x => x.name.toLowerCase().includes(String(p.name || "").toLowerCase()));
      if (!m) return done("ما لقيت هالشخص");
      try { await api("/api/nudge", { toId: m.id }); } catch (e) { toast(e.message); }
      return done(c.say || `نبّهت ${m.name}`);
    }
    default: return false;
  }
}

// ---------- squad quiz battles ----------
let quizSeen = -1, quizTickH = null;
$("#btn-quiz").onclick = () => {
  if (!curGroup) return toast("لازم قروب أول");
  modal("تحدي السرعة", `
    <p class="muted">الأسئلة تنزل للكل بنفس الوقت — ٢٢ ثانية للسؤال، والأسرع الصح ياخذ نقاط أكثر. الفائز ياخذ ١٥٠ عملة.</p>
    <label>الموضوع (اختياري)</label><input id="m-qtopic" placeholder="مثال: الهندسة، التناظر اللفظي" maxlength="60">
    <label>عدد الأسئلة</label><input type="number" id="m-qcount" min="3" max="12" value="6">`,
    async () => {
      const t = $("#m-qtopic").value.trim(), n = Number($("#m-qcount").value) || 6;
      closeModal();
      startQuiz(n, t);
      return false;
    }, "ابدأ التحدي");
};
async function startQuiz(count, topic) {
  if (!curGroup) return toast("لازم قروب أول");
  toast("يجهّز الأسئلة…", 25000);
  try {
    await api("/api/quiz/start", { groupCode: curGroup, count, topic, exam: S.exam || "general" });
    $("#toast").classList.add("hidden");
    refresh();
  } catch (e) { sfx.error(); toast(e.message, 5000); }
}
function renderQuiz(g) {
  const q = g?.quiz;
  const overlay = $("#quiz");
  if (!q) { if (!overlay.classList.contains("hidden")) { overlay.classList.add("hidden"); clearInterval(quizTickH); quizTickH = null; } quizSeen = -1; return; }
  if (overlay.classList.contains("hidden")) {
    overlay.classList.remove("hidden");
    if (!quizTickH) quizTickH = setInterval(() => { const gg = state?.groups.find(x => x.code === curGroup); if (gg?.quiz) paintQuiz(gg.quiz); }, 250);
    sfx.complete();
  }
  $("#quiz-title").textContent = q.title || "تحدي السرعة";
  paintQuiz(q);
}
function paintQuiz(q) {
  const now = Date.now();
  if (q.startsIn > 0 || (q.qi === undefined && !q.done)) {
    const secs = Math.ceil((q.startsIn - (now - stateAt)) / 1000);
    $("#quiz-count").textContent = "";
    $("#quiz-timer-fill").style.width = "100%";
    $("#quiz-body").innerHTML = `<div class="quiz-countdown"><b>${Math.max(1, secs)}</b><span class="muted">استعد…</span></div>`;
    return;
  }
  if (q.done) {
    const s = q.scores || [];
    $("#quiz-count").textContent = "انتهى";
    $("#quiz-timer-fill").style.width = "0%";
    $("#quiz-body").innerHTML = `<div class="quiz-winner">
      ${s[0] ? `<div class="muted">الفائز</div><b>${esc(s[0].name)}</b><div class="muted">${s[0].pts} نقطة · ${s[0].right} صح</div>` : `<div class="muted">ما فيه فائز</div>`}
      ${q.winner ? `<div class="res-delta recap-up">+150 عملة</div>` : ""}</div>`;
    renderQuizScores(q.scores);
    if (quizSeen !== -2) { quizSeen = -2; if (s[0]?.id === cfg.userId) { confetti(); sfx.complete(); } }
    return;
  }
  const left = Math.max(0, (q.endsAt - (now - stateAt + stateAt)) / 1000);
  const frac = Math.max(0, Math.min(1, left / 22));
  $("#quiz-count").textContent = `${q.qi + 1} / ${q.total}`;
  const bar = $("#quiz-timer-fill");
  bar.style.width = (frac * 100) + "%";
  bar.classList.toggle("low", left < 6);
  if (quizSeen !== q.qi) { quizSeen = q.qi; sfx.click(); }
  const picked = q.mine?.c;
  const reveal = q.answer !== undefined;
  $("#quiz-body").innerHTML = `
    ${q.topic ? `<span class="exam-topic">${esc(q.topic)}</span>` : ""}
    <div class="quiz-q" dir="auto">${esc(q.q)}</div>
    <div class="exam-choices">${q.choices.map((c, i) => {
      let cls = "";
      if (reveal) cls = i === q.answer ? "ok" : (i === picked ? "bad" : "");
      else if (i === picked) cls = "sel";
      return `<button class="exam-choice ${cls}" data-qc="${i}" ${picked !== undefined || reveal ? "disabled" : ""} dir="auto"><span class="ck">${AR_LETTER[i] || i + 1}</span><span>${esc(c)}</span></button>`;
    }).join("")}</div>
    ${reveal && q.why ? `<div class="exam-why" dir="auto">${esc(q.why)}</div>` : ""}
    <div class="muted" style="font-size:12px;margin-top:10px;text-align:center">${q.answeredCount || 0} جاوبوا</div>`;
  renderQuizScores(q.scores);
}
function renderQuizScores(scores) {
  $("#quiz-scores").innerHTML = (scores || []).map((s, i) => `
    <div class="qs-row ${s.id === cfg.userId ? "me" : ""}">
      <span class="qsrank">${i + 1}</span>${av(s, "av-sm")}
      <span class="qsname">${esc(s.name)}</span>
      <span class="tick">${s.right ? "✓".repeat(Math.min(s.right, 5)) : ""}</span>
      <span class="qspts">${s.pts}</span>
    </div>`).join("");
}
$("#quiz-body").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-qc]"); if (!b || b.disabled) return;
  const g = state?.groups.find(x => x.code === curGroup);
  if (!g?.quiz) return;
  $$("#quiz-body [data-qc]").forEach(x => x.disabled = true);
  b.classList.add("sel"); sfx.click();
  try { await api("/api/quiz/answer", { groupCode: curGroup, qi: g.quiz.qi, choice: Number(b.dataset.qc) }); refresh(); }
  catch (err) { toast(err.message); }
});
$("#quiz-x").onclick = () => { $("#quiz").classList.add("hidden"); clearInterval(quizTickH); quizTickH = null; };

// ---------- material library ----------
function showLibrary() {
  const me = state?.me; if (!me) return;
  const lib = me.library || [];
  modal("مكتبتي", `
    <p class="muted">ارفع ملفاتك مرة وحدة، وبعدها ولّد منها اختبارات وقت ما تبي.</p>
    ${lib.length ? lib.map(l => `<div class="lib-row">
      <div style="min-width:0;flex:1"><div class="lname">${esc(l.name)}</div><div class="lmeta">${(l.chars / 1000).toFixed(1)}k حرف · ${new Date(l.at).toLocaleDateString()}</div></div>
      <button class="btn small pop-cyan" data-lib="${l.id}">اختبار</button>
      <button class="lib-x" data-libx="${l.id}" title="حذف">✕</button>
    </div>`).join("") : `<div class="empty">${EMPTY_RING}<span>مكتبتك فاضية</span></div>`}
    <button class="btn candy wide" id="lib-add" style="margin-top:14px">＋ أضف ملف للمكتبة</button>`, async () => {}, "إغلاق");
  $("#lib-add").onclick = () => $("#lib-file").click();
  $("#modal-body").onclick = async (e) => {
    const gen = e.target.closest("[data-lib]");
    if (gen) {
      const l = lib.find(x => x.id === gen.dataset.lib);
      closeModal();
      await buildExam({ libId: gen.dataset.lib, count: 10, mins: 0, title: l?.name });
      return;
    }
    const del = e.target.closest("[data-libx]");
    if (del) {
      try { await api("/api/library/remove", { id: del.dataset.libx }); await refresh(); showLibrary(); } catch (err) { toast(err.message); }
    }
  };
}

// ---------- weekly recap ----------
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  return y + "-W" + Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
}
let recapShown = false;
function recapCheck(me, g) {
  const wk = isoWeek(new Date());
  let rec = JSON.parse(localStorage.getItem("weekRecap") || "null");
  if (!rec) { localStorage.setItem("weekRecap", JSON.stringify({ week: wk, total: me.week, prevTotal: 0 })); return; }
  if (rec.week === wk) {
    rec.total = me.week;
    localStorage.setItem("weekRecap", JSON.stringify(rec));
    return;
  }
  // new week — show recap once
  const last = rec.total, prev = rec.prevTotal || 0, delta = last - prev;
  localStorage.setItem("weekRecap", JSON.stringify({ week: wk, total: me.week, prevTotal: last }));
  if (recapShown) return;
  recapShown = true;
  const best = Math.max(...(me.days || [0]));
  let rankLine = "";
  if (g && g.members.length > 1) {
    const rows = [...g.members].sort((a, b) => b.week - a.week);
    rankLine = `<div class="recap-row"><span>Rank in ${esc(g.name)}</span><b>#${rows.findIndex(m => m.id === me.id) + 1} of ${rows.length}</b></div>`;
  }
  modal("Your week in review", `
    <div class="recap-row"><span>Hours studied</span><b>${fmtHM(last)}</b></div>
    <div class="recap-row"><span>vs previous week</span><b class="${delta >= 0 ? "recap-up" : "recap-down"}">${delta >= 0 ? "▲ +" : "▼ −"}${fmtHM(Math.abs(delta))}</b></div>
    <div class="recap-row"><span>Best day</span><b>${fmtHM(best)}</b></div>
    ${rankLine}
    <p class="hint">${delta > 0 ? "You leveled up your week. Keep the momentum." : prev > 0 ? "Down week. This one's a comeback." : "First full week logged — baseline set."}</p>`,
    async () => {}, "Let's go");
  if (delta > 0) { confetti(); sfx.complete(); }
}

// ---------- onboarding & boot ----------
function renderSkeletons() { // shown until the first /api/state lands
  $("#member-strip").innerHTML = `<div class="skel-strip">${`<span class="skel skel-circle"></span>`.repeat(4)}</div>`;
  $("#board").innerHTML = `<div class="skel skel-row"></div>`.repeat(4);
  $("#live-list").innerHTML = `<div class="skel skel-row" style="height:42px"></div>`.repeat(2);
}
function boot() {
  drawTicks(); renderModes(); resetTimerUI(); renderGreeting(); sessionDots(false); updateSavedBadge();
  if (cfg.userId) renderSkeletons();
  if (!cfg.userId) {
    $("#onboard").classList.remove("hidden");
    $("#ob-server").value = cfg.server || "http://localhost:5050";
    $("#ob-go").onclick = async () => {
      const name = $("#ob-name").value.trim();
      const server = $("#ob-server").value.trim().replace(/\/+$/, "");
      if (!name) return $("#ob-err").textContent = "Enter your name";
      $("#ob-err").textContent = ""; $("#ob-go").disabled = true; $("#ob-go").textContent = "Connecting…";
      try {
        const h = await fetch(server + "/api/health").then(r => r.json());
        if (!h.ok) throw new Error();
        cfg.server = server;
        const r = await fetch(server + "/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(r => r.json());
        cfg.saveUser(r);
        $("#onboard").classList.add("hidden");
        sfx.complete(); confetti();
        toast(`Welcome, ${name}! Create a group and invite your friends`);
        refresh();
      } catch {
        sfx.error();
        $("#ob-err").textContent = "Can't reach that server — is it running?";
      }
      $("#ob-go").disabled = false; $("#ob-go").textContent = "Let's lock in";
    };
    $("#ob-name").focus();
  } else refresh();
}
setInterval(refresh, 5000);
boot();
