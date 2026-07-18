// LockIn server — single-file Express API with JSON-file storage.
// Run: node server.js  (PORT env optional, default 5050)
// Deploy free on Render/Railway, or one friend runs it and shares their address.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 5050;
const DB_FILE = path.join(process.env.DATA_DIR || __dirname, "db.json");

// ---------- storage: JSON blob, persisted to Postgres when DATABASE_URL is set (survives Render restarts), file otherwise ----------
let db = { users: {}, groups: {}, challenges: {} };
let pgPool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
}
async function loadDb() {
  if (pgPool) {
    await pgPool.query("CREATE TABLE IF NOT EXISTS lockin_db (id INT PRIMARY KEY, data JSONB NOT NULL, updated TIMESTAMPTZ DEFAULT now())");
    const r = await pgPool.query("SELECT data FROM lockin_db WHERE id=1");
    if (r.rows[0]) { db = r.rows[0].data; console.log("db loaded from Postgres"); return; }
    console.log("Postgres empty — starting fresh (will persist there)");
  }
  try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); console.log("db loaded from file"); } catch {}
}
let saveTimer = null, saving = false, dirty = false;
async function flush() {
  if (saving) { dirty = true; return; }
  saving = true;
  const snapshot = JSON.stringify(db);
  try {
    fs.writeFileSync(DB_FILE, snapshot);
    if (pgPool) await pgPool.query("INSERT INTO lockin_db (id, data, updated) VALUES (1, $1::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data=$1::jsonb, updated=now()", [snapshot]);
  } catch (e) { console.error("save failed:", e.message); }
  saving = false;
  if (dirty) { dirty = false; flush(); }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

const presence = {}; // userId -> {studying, activity, elapsed, lastSeen}  (in-memory only)

const app = express();
app.use(express.json({ limit: "1mb" })); // room for base64 avatar uploads (client resizes to 128px first)
// serve the web version if the renderer folder is nearby (repo layout)
const webDir = path.join(__dirname, "..", "app", "renderer");
if (fs.existsSync(webDir)) app.use(express.static(webDir));
app.use((req, res, next) => { // CORS for dev/browser use
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.end();
  next();
});

const id = () => crypto.randomBytes(8).toString("hex");
const today = () => new Date().toISOString().slice(0, 10);

function auth(req, res) {
  const { userId, secret } = req.method === "GET" ? req.query : req.body;
  const u = db.users[userId];
  if (!u || u.secret !== secret) { res.status(401).json({ error: "bad credentials" }); return null; }
  return u;
}

// ---------- streak helpers ----------
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }
function currentStreak(u) {
  if (!u.lastStudyDay) return 0;
  const gap = daysBetween(u.lastStudyDay, today());
  if (gap <= 1) return u.streak;
  if (gap === 2 && (u.freezes || 0) > 0) return u.streak; // protected by a streak freeze
  return 0;
}

// ---------- daily quests (seeded per day, verified server-side) ----------
function questDefs(dateStr) {
  let h = 0;
  for (const c of dateStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const mins = [30, 45, 60, 90][h % 4];
  const sess = 2 + (h % 2);
  const early = h % 2 === 0;
  return [
    { id: 0, title: `Study ${mins} minutes today`, target: mins, reward: mins },
    { id: 1, title: `Complete ${sess} focus sessions`, target: sess, reward: 20 + sess * 15 },
    { id: 2, title: early ? "Log a session before noon" : "Log a session after 8 PM", target: 1, reward: 50, window: early ? "early" : "late" },
  ];
}
function questState(u) {
  const d = today();
  const flags = u.qFlags?.date === d ? u.qFlags : {};
  const claimed = u.qClaimed?.date === d ? u.qClaimed.ids : [];
  return questDefs(d).map(q => {
    let progress = 0;
    if (q.id === 0) progress = Math.floor((u.dayTotals[d] || 0) / 60);
    if (q.id === 1) progress = u.sessToday?.date === d ? u.sessToday.n : 0;
    if (q.id === 2) progress = flags[q.window] ? 1 : 0;
    return { ...q, progress: Math.min(progress, q.target), done: progress >= q.target, claimed: claimed.includes(q.id) };
  });
}

// ---------- routes ----------
app.get("/api/health", (req, res) => res.json({
  ok: true, app: "lockin",
  storage: pgPool ? "postgres" : "file",
  hasDbUrl: !!process.env.DATABASE_URL,
  users: Object.keys(db.users).length,
  version: "3.3",
}));

app.post("/api/register", (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: "name required" });
  const userId = id();
  db.users[userId] = { id: userId, name, secret: id() + id(), avatar: Math.floor(Math.random() * 12), coins: 0, totalSeconds: 0, streak: 0, lastStudyDay: null, dayTotals: {}, groups: [] };
  save();
  res.json({ userId, secret: db.users[userId].secret, name });
});

app.post("/api/group", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const name = String(req.body.name || "").trim().slice(0, 32) || "Study Group";
  let code;
  do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (db.groups[code]);
  db.groups[code] = { code, name, members: [u.id], createdAt: Date.now() };
  u.groups.push(code);
  save();
  res.json({ code });
});

app.post("/api/group/join", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const g = db.groups[String(req.body.code || "").trim().toUpperCase()];
  if (!g) return res.status(404).json({ error: "No group with that code" });
  if (!g.members.includes(u.id)) g.members.push(u.id);
  if (!u.groups.includes(g.code)) u.groups.push(g.code);
  save();
  res.json({ code: g.code });
});

app.post("/api/group/leave", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const g = db.groups[req.body.code];
  if (g) g.members = g.members.filter(m => m !== u.id);
  u.groups = u.groups.filter(c => c !== req.body.code);
  save();
  res.json({ ok: true });
});

app.post("/api/challenge", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const g = db.groups[req.body.groupCode];
  if (!g || !g.members.includes(u.id)) return res.status(404).json({ error: "not in group" });
  const type = ["solo", "race", "team", "streak"].includes(req.body.type) ? req.body.type : "solo";
  const target = Math.max(1, Math.min(1000, Number(req.body.target) || 10)); // hours, or days for streak
  const c = { id: id(), groupCode: g.code, type, title: String(req.body.title || "").trim().slice(0, 48) || "Challenge", target, progress: {}, createdBy: u.id, createdAt: Date.now(), winner: null };
  db.challenges[c.id] = c;
  save();
  res.json({ id: c.id });
});

app.post("/api/profile", (req, res) => {
  const u = auth(req, res); if (!u) return;
  if (req.body.name) u.name = String(req.body.name).trim().slice(0, 24) || u.name;
  if (req.body.avatar !== undefined) u.avatar = Math.max(0, Math.min(11, Number(req.body.avatar) || 0));
  if (req.body.avatarImg !== undefined) {
    const img = String(req.body.avatarImg || "");
    if (img === "") u.avatarImg = undefined; // clear back to gradient
    else if (/^data:image\/(png|jpeg|webp);base64,/.test(img) && img.length <= 400_000) u.avatarImg = img;
    else return res.status(400).json({ error: "avatar must be a small png/jpeg/webp image" });
  }
  save();
  res.json({ ok: true });
});

// ---------- coin shop ----------
const SHOP = {
  frame: { gold: 300, neon: 500, fire: 800, rainbow: 1200 },
  flair: { "EARLY BIRD": 200, "NIGHT OWL": 200, "GRINDER": 400, "LOCKED IN": 600 },
  theme: { ocean: 1000, sunset: 1000 },
};
app.post("/api/shop/buy", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const { slot, item } = req.body;
  const price = SHOP[slot]?.[item];
  if (price === undefined) return res.status(404).json({ error: "no such item" });
  u.owned = u.owned || [];
  const key = slot + ":" + item;
  if (u.owned.includes(key)) return res.status(400).json({ error: "already owned" });
  if (u.coins < price) return res.status(400).json({ error: `Not enough coins — need ${price - u.coins} more` });
  u.coins -= price;
  u.owned.push(key);
  u.equipped = u.equipped || {};
  u.equipped[slot] = item; // auto-equip on purchase
  save();
  res.json({ ok: true, coins: u.coins });
});
app.post("/api/shop/equip", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const { slot, item } = req.body;
  u.equipped = u.equipped || {};
  if (item === null || item === "") delete u.equipped[slot];
  else if ((u.owned || []).includes(slot + ":" + item)) u.equipped[slot] = item;
  else return res.status(400).json({ error: "not owned" });
  save();
  res.json({ ok: true });
});

app.post("/api/shop/freeze", (req, res) => {
  const u = auth(req, res); if (!u) return;
  if ((u.freezes || 0) >= 2) return res.status(400).json({ error: "Max 2 freezes held" });
  if (u.coins < 400) return res.status(400).json({ error: `Not enough coins — need ${400 - u.coins} more` });
  u.coins -= 400; u.freezes = (u.freezes || 0) + 1;
  save();
  res.json({ ok: true, freezes: u.freezes, coins: u.coins });
});

app.post("/api/quest/claim", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const q = questState(u).find(x => x.id === Number(req.body.id));
  if (!q) return res.status(404).json({ error: "no such quest" });
  if (!q.done) return res.status(400).json({ error: "quest not complete yet" });
  if (q.claimed) return res.status(400).json({ error: "already claimed" });
  const d = today();
  u.qClaimed = u.qClaimed?.date === d ? u.qClaimed : { date: d, ids: [] };
  u.qClaimed.ids.push(q.id);
  u.coins += q.reward;
  save();
  res.json({ ok: true, reward: q.reward, coins: u.coins });
});

// ---------- group focus rooms (synced pomodoro) ----------
app.post("/api/room/start", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const g = db.groups[req.body.groupCode];
  if (!g || !g.members.includes(u.id)) return res.status(404).json({ error: "not in group" });
  const mins = Math.max(5, Math.min(180, Number(req.body.minutes) || 25));
  g.room = { mode: mins * 60, startAt: Date.now(), by: u.id };
  save();
  res.json({ ok: true });
});
app.post("/api/room/stop", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const g = db.groups[req.body.groupCode];
  if (g && g.room && (g.room.by === u.id)) { delete g.room; save(); }
  res.json({ ok: true });
});

// ---------- nudges (poke an idle friend; delivered once via state) ----------
const nudgeLimit = {}; // "fromId>toId" -> ts
app.post("/api/nudge", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const target = db.users[req.body.toId];
  if (!target) return res.status(404).json({ error: "no such user" });
  const key = u.id + ">" + target.id;
  if (nudgeLimit[key] && Date.now() - nudgeLimit[key] < 3600e3) return res.status(429).json({ error: "Already nudged them recently" });
  nudgeLimit[key] = Date.now();
  target.nudges = (target.nudges || []).slice(-9);
  target.nudges.push({ from: u.name, at: Date.now() });
  save();
  res.json({ ok: true });
});

// ---------- group chat (capped ring buffer per group) ----------
app.post("/api/chat", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const g = db.groups[req.body.groupCode];
  if (!g || !g.members.includes(u.id)) return res.status(404).json({ error: "not in group" });
  const text = String(req.body.text || "").trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: "empty" });
  g.msgs = g.msgs || [];
  g.msgs.push({ uid: u.id, text, at: Date.now() });
  if (g.msgs.length > 200) g.msgs = g.msgs.slice(-200);
  save();
  res.json({ ok: true });
});

app.post("/api/presence", (req, res) => {
  const u = auth(req, res); if (!u) return;
  presence[u.id] = { studying: !!req.body.studying, activity: String(req.body.activity || "").slice(0, 32), elapsed: Number(req.body.elapsed) || 0, lastSeen: Date.now() };
  res.json({ ok: true });
});

app.post("/api/session", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const seconds = Math.max(0, Math.min(12 * 3600, Math.floor(Number(req.body.seconds) || 0)));
  if (seconds < 60) return res.json({ ok: true, ignored: true }); // <1min doesn't count
  const d = today();
  u.dayTotals[d] = (u.dayTotals[d] || 0) + seconds;
  u.totalSeconds += seconds;
  const coinsEarned = Math.floor(seconds / 60);
  u.coins += coinsEarned;
  if (u.lastStudyDay !== d) {
    const gap = u.lastStudyDay ? daysBetween(u.lastStudyDay, d) : 99;
    if (gap === 1) u.streak += 1;
    else if (gap === 2 && (u.freezes || 0) > 0) { u.freezes--; u.streak += 1; } // freeze consumed, streak saved
    else u.streak = 1;
    u.lastStudyDay = d;
  }
  // quest + stats bookkeeping
  u.sessToday = u.sessToday?.date === d ? { date: d, n: u.sessToday.n + 1 } : { date: d, n: 1 };
  const hr = new Date().getHours();
  u.qFlags = u.qFlags?.date === d ? u.qFlags : { date: d };
  if (hr < 12) u.qFlags.early = true;
  if (hr >= 20) u.qFlags.late = true;
  const subj = (String(req.body.activity || "").trim().toLowerCase() || "other").slice(0, 32);
  u.subjects = u.subjects || {};
  u.subjects[subj] = (u.subjects[subj] || 0) + seconds;
  u.hours = u.hours || Array(24).fill(0);
  u.hours[hr] += seconds;
  u.maxSession = Math.max(u.maxSession || 0, seconds);
  // challenge progress for every unfinished hour-based challenge in the user's groups
  for (const c of Object.values(db.challenges)) {
    if (c.winner || c.type === "streak" || !u.groups.includes(c.groupCode)) continue;
    c.progress[u.id] = (c.progress[u.id] || 0) + seconds;
    const goal = c.target * 3600;
    if (c.type === "race" && c.progress[u.id] >= goal) c.winner = u.id;
    if (c.type === "solo" && c.progress[u.id] >= goal && !c.winner) c.winner = u.id;
    if (c.type === "team" && Object.values(c.progress).reduce((a, b) => a + b, 0) >= goal) c.winner = "team";
  }
  presence[u.id] = { studying: false, lastSeen: Date.now() };
  save();
  res.json({ ok: true, coinsEarned, streak: u.streak });
});

app.get("/api/state", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const now = Date.now();
  const pub = (m) => {
    const mu = db.users[m];
    const p = presence[m];
    const live = p && now - p.lastSeen < 20000;
    return mu && {
      id: mu.id, name: mu.name, avatar: mu.avatar || 0, avatarImg: mu.avatarImg || null,
      frame: mu.equipped?.frame || null, flair: mu.equipped?.flair || null,
      owned: m === u.id ? (mu.owned || []) : undefined, theme: m === u.id ? mu.equipped?.theme || null : undefined,
      freezes: m === u.id ? (mu.freezes || 0) : undefined,
      coins: mu.coins, totalSeconds: mu.totalSeconds,
      streak: currentStreak(mu), today: mu.dayTotals[today()] || 0,
      week: last7(mu).reduce((a, b) => a + b, 0), days: last7(mu), studying: !!(live && p.studying),
      activity: live && p.studying ? p.activity : null, elapsed: live && p.studying ? p.elapsed : 0,
    };
  };
  function last7(mu) { // oldest → today
    return Array.from({ length: 7 }, (_, i) => mu.dayTotals[new Date(now - (6 - i) * 864e5).toISOString().slice(0, 10)] || 0);
  }
  const groups = u.groups.map(code => {
    const g = db.groups[code];
    if (!g) return null;
    if (g.room && now > g.room.startAt + g.room.mode * 1000 + 5000) delete g.room; // expired
    return {
      code, name: g.name,
      room: g.room ? { ...g.room, byName: db.users[g.room.by]?.name || "?" } : null,
      msgs: (g.msgs || []).slice(-50).map(m => ({ uid: m.uid, name: db.users[m.uid]?.name || "?", avatar: db.users[m.uid]?.avatar || 0, avatarImg: db.users[m.uid]?.avatarImg || null, text: m.text, at: m.at })),
      members: g.members.map(pub).filter(Boolean),
      challenges: Object.values(db.challenges).filter(c => c.groupCode === code)
        .map(c => ({ ...c, winnerName: c.winner === "team" ? "team" : db.users[c.winner]?.name || null, streaks: c.type === "streak" ? Object.fromEntries(g.members.map(m => [m, currentStreak(db.users[m] || {})])) : undefined })),
    };
  }).filter(Boolean);
  const me = pub(u.id);
  me.quests = questState(u);
  me.nudges = u.nudges || [];
  if (u.nudges?.length) { u.nudges = []; save(); } // deliver once
  // deep stats (self only)
  me.days90 = Array.from({ length: 90 }, (_, i) => u.dayTotals[new Date(now - (89 - i) * 864e5).toISOString().slice(0, 10)] || 0);
  me.exams = (u.exams || []).slice(-12);
  me.weakTopics = weakTopics(u).slice(0, 6);
  me.subjects = Object.entries(u.subjects || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  me.hours = u.hours || Array(24).fill(0);
  me.maxSession = u.maxSession || 0;
  res.json({ me, groups });
});

// ---------- AI study assistant (OpenRouter proxy — key stays server-side) ----------
const AI_KEY = process.env.OPENROUTER_API_KEY ||
  (fs.existsSync(path.join(__dirname, "openrouter.key")) ? fs.readFileSync(path.join(__dirname, "openrouter.key"), "utf8").trim() : "");
// model chain: env override, else auto-discovered from OpenRouter's public model list (refreshed every 12h)
const AI_PREFERRED = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-20b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
];
let AI_MODELS = process.env.AI_MODELS ? process.env.AI_MODELS.split(",") : [...AI_PREFERRED];
// vision-capable free models, for photo questions and scanned pages
const VISION_PREFERRED = [
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "qwen/qwen2.5-vl-72b-instruct:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",
  "google/gemma-3-27b-it:free",
];
let VISION_MODELS = process.env.VISION_MODELS ? process.env.VISION_MODELS.split(",") : [...VISION_PREFERRED];
async function discoverFreeModels() {
  if (process.env.AI_MODELS) return;
  try {
    const j = await (await fetch("https://openrouter.ai/api/v1/models")).json();
    const freeModels = j.data.filter(m => m.id.endsWith(":free"));
    const free = new Set(freeModels.map(m => m.id));
    if (!free.size) return;
    const chain = AI_PREFERRED.filter(id => free.has(id));
    for (const id of free) { if (chain.length >= 8) break; if (!chain.includes(id)) chain.push(id); }
    AI_MODELS = chain;
    console.log(`AI models: ${chain.slice(0, 3).join(", ")} (+${Math.max(0, chain.length - 3)} fallbacks)`);
    if (!process.env.VISION_MODELS) { // models that actually accept images
      const canSee = new Set(freeModels.filter(m => (m.architecture?.input_modalities || []).includes("image")).map(m => m.id));
      const vchain = [...VISION_PREFERRED.filter(id => canSee.has(id)), ...[...canSee].filter(id => !VISION_PREFERRED.includes(id))].slice(0, 6);
      if (vchain.length) { VISION_MODELS = vchain; console.log(`Vision models: ${vchain.slice(0, 2).join(", ")} (+${Math.max(0, vchain.length - 2)})`); }
    }
  } catch (e) { console.log("AI model discovery failed, using defaults:", e.message); }
}
discoverFreeModels();
setInterval(discoverFreeModels, 12 * 3600e3);
const aiUse = {}; // userId -> [timestamps], simple 40-req/hour limit
function rateOk(u, res, cost = 1) {
  const now = Date.now();
  aiUse[u.id] = (aiUse[u.id] || []).filter(t => now - t < 3600e3);
  if (aiUse[u.id].length + cost > 40) { res.status(429).json({ error: "AI limit reached — try again in a bit" }); return false; }
  for (let i = 0; i < cost; i++) aiUse[u.id].push(now);
  return true;
}
// shared OpenRouter call with model fallback; `models` lets vision calls use a different chain
async function callAI(messages, { maxTokens = 800, models = AI_MODELS } = {}) {
  let lastErr = "AI unavailable";
  for (const model of models) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${AI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.trim(), messages, max_tokens: maxTokens }),
      });
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content;
      if (r.ok && text) return { text, model: model.trim() };
      lastErr = j.error?.message || `model ${model.trim()} unavailable`;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr);
}
// free models are sloppy: dig JSON out of prose/markdown fences
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const s = c.indexOf("["), sObj = c.indexOf("{");
    const start = s >= 0 && (sObj < 0 || s < sObj) ? s : sObj;
    if (start < 0) continue;
    const open = c[start], close = open === "[" ? "]" : "}";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try { return JSON.parse(c.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

app.post("/api/ai", async (req, res) => {
  const u = auth(req, res); if (!u) return;
  if (!AI_KEY) return res.status(503).json({ error: "AI not configured on this server (set OPENROUTER_API_KEY)" });
  if (!rateOk(u, res)) return;

  const history = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .slice(-12)
    .filter(m => ["user", "assistant"].includes(m.role))
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (!history.length) return res.status(400).json({ error: "no message" });
  const ctx = req.body.ctx || {};
  const EXAMS = {
    "qudurat-cbt": "اختبار القدرات العامة (علمي) — محوسب",
    "qudurat-paper": "اختبار القدرات العامة (علمي) — ورقي",
    "tahsili": "الاختبار التحصيلي (علمي)",
    "tahsili-early": "التحصيلي المبكر لجامعة الملك فهد للبترول والمعادن",
    "step": "اختبار STEP (كفايات اللغة الإنجليزية)",
  };
  const examLine = EXAMS[ctx.exam] ? `الطالب يستعد حالياً لـ: ${EXAMS[ctx.exam]}.` : "";
  const ctxBits = [
    examLine,
    examMemory(u),
    ctx.daysLeft > 0 ? `باقي على اختباره ${Math.min(999, Number(ctx.daysLeft) | 0)} يوم.` : "",
    ctx.activity ? `He is currently studying: ${String(ctx.activity).slice(0, 64)}.` : "",
    ctx.todayMin > 0 ? `Focused ${Math.min(1440, Number(ctx.todayMin) | 0)} minutes today.` : "",
    ctx.streak > 1 ? `On a ${Math.min(9999, Number(ctx.streak) | 0)}-day streak.` : "",
  ].filter(Boolean).join(" ");
  const messages = [{
    role: "system",
    content: `You are the built-in tutor of LockIn. Your ONLY specialty is Saudi standardized tests (قياس / هيئة تقويم التعليم والتدريب). The user is ${u.name}. ${ctxBits}

Your expertise:
1. القدرات العامة (علمي) — ورقي ومحوسب. قسمان: لفظي (التناظر اللفظي، إكمال الجمل، استيعاب المقروء، الخطأ السياقي) وكمي (الحساب، الجبر، الهندسة، التحليل الإحصائي). الورقي خمسة أقسام متناوبة، والمحوسب أربعة أقسام، لكل قسم نحو 25 دقيقة. الدرجة من 100. المحتوى واحد بين الورقي والمحوسب؛ الفرق في طريقة التقديم وسرعة النتيجة وعدد فرص الإعادة.
2. STEP — كفايات اللغة الإنجليزية: استيعاب المقروء (~40%)، التراكيب النحوية (~30%)، الاستيعاب السماعي (~20%)، التحليل الكتابي (~10%). الدرجة من 100.
3. التحصيلي (علمي): رياضيات، فيزياء، كيمياء، أحياء. يغطي مناهج الصفوف الثلاثة الثانوية بتوزيع تقريبي: أول ثانوي 20%، ثاني ثانوي 30%، ثالث ثانوي 50%. الدرجة من 100.
4. التحصيلي المبكر لجامعة الملك فهد للبترول والمعادن: نفس المواد العلمية، يُقدَّم مبكراً ضمن مسار القبول المبكر للجامعة. ركّز على التأسيس القوي وحل التجميعات.

Hard rules:
- Direct and blunt. صفر مجاملات وصفر حشو. No fake cheer, no "رائع!" unless genuinely earned. If his answer is wrong: قل "غلط"، ليش غلط، وكيف يحلها صح.
- NEVER invent exam statistics, question counts, percentages, or dates you are not certain of. Say "ما أجزم بالرقم — تأكد من موقع قياس" instead. Accuracy over confidence.
- Practice questions: سؤال واحد فقط في كل رسالة، بأربعة خيارات (أ/ب/ج/د)، بمستوى قياس الحقيقي. انتظر جوابه، ثم: صح/غلط، السبب باختصار، وطريقة الحل السريعة (الشورت كت).
- Study plans: concrete daily blocks tied to his remaining days and weak areas. No generic advice like "ذاكر كل يوم".
- Reply in the user's language (Arabic or English). Saudi curriculum terms stay in Arabic.
- Formatting: **bold**, \`code\`, "- " bullets only. No headers, no tables.`,
  }, ...history];

  try {
    const { text, model } = await callAI(messages);
    res.json({ reply: text, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- exam memory: the tutor remembers every mock exam you've taken ----------
function examMemory(u) {
  const ex = u.exams || [];
  if (!ex.length) return "";
  const recent = ex.slice(-4);
  const lines = recent.map(e => `${new Date(e.at).toISOString().slice(0, 10)}: ${e.title} — ${e.score}/100 (${e.correct}/${e.total} صح)`).join("؛ ");
  const weak = weakTopics(u).slice(0, 4).map(w => `${w.topic} ${w.pct}%`).join("، ");
  const trend = ex.length >= 2 ? (ex[ex.length - 1].score - ex[0].score >= 0 ? "متحسّن" : "متراجع") : "";
  return `سجل اختباراته التجريبية داخل التطبيق (تذكّرها واستشهد بها): ${lines}.${weak ? ` أضعف مواضيعه: ${weak}.` : ""}${trend ? ` الاتجاه العام: ${trend}.` : ""}`;
}
function weakTopics(u) {
  const t = u.topicStats || {};
  return Object.entries(t)
    .filter(([, v]) => v.total >= 3)
    .map(([topic, v]) => ({ topic, pct: Math.round(v.correct / v.total * 100), total: v.total }))
    .sort((a, b) => a.pct - b.pct);
}

// ---------- PDF / photo → text ----------
async function docToText(dataUrl, filename) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!m) throw new Error("bad file");
  const [, mime, b64] = m;
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 8e6) throw new Error("File too big (max 8MB)");
  if (mime === "application/pdf" || /\.pdf$/i.test(filename || "")) {
    const pdf = require("pdf-parse");
    const out = await pdf(buf);
    const text = (out.text || "").trim();
    if (text.length < 40) throw new Error("Couldn't read text from that PDF — it may be scanned images. Try the photo option instead.");
    return { kind: "text", text: text.slice(0, 24000) };
  }
  if (/^image\//.test(mime)) return { kind: "image", dataUrl };
  if (/^text\//.test(mime)) return { kind: "text", text: buf.toString("utf8").slice(0, 24000) };
  throw new Error("Unsupported file — use PDF, image, or text");
}

// ---------- generate a mock test (from a document or from a topic) ----------
app.post("/api/exam/generate", async (req, res) => {
  const u = auth(req, res); if (!u) return;
  if (!AI_KEY) return res.status(503).json({ error: "AI not configured on this server" });
  if (!rateOk(u, res, 3)) return;
  const count = Math.max(3, Math.min(20, Number(req.body.count) || 10));
  const exam = String(req.body.exam || "general").slice(0, 32);
  let source = "", visionParts = null, title = String(req.body.title || "").slice(0, 60);
  try {
    if (req.body.file) {
      const doc = await docToText(req.body.file, req.body.filename);
      if (doc.kind === "text") source = doc.text;
      else visionParts = [{ type: "text", text: "استخرج محتوى هذه الصورة (أسئلة أو مادة دراسية) كنص عربي/إنجليزي كامل، بدون شرح." }, { type: "image_url", image_url: { url: doc.dataUrl } }];
      title = title || (req.body.filename || "ملفي").slice(0, 60);
    } else {
      source = String(req.body.topic || "").slice(0, 500);
      title = title || source.slice(0, 60) || "اختبار تجريبي";
    }
    if (visionParts) {
      const { text } = await callAI([{ role: "user", content: visionParts }], { maxTokens: 1500, models: VISION_MODELS });
      source = text;
    }
    if (!source.trim()) return res.status(400).json({ error: "no content to build a test from" });

    const sys = `أنت مُعِدّ اختبارات محترف لاختبارات قياس السعودية (${exam}). مهمتك: توليد أسئلة اختيار من متعدد بمستوى الاختبار الحقيقي، مبنية حصراً على المادة المعطاة.
أخرج JSON فقط بدون أي نص قبله أو بعده، بهذا الشكل بالضبط:
{"questions":[{"q":"نص السؤال","choices":["أ","ب","ج","د"],"answer":0,"topic":"اسم الموضوع","why":"سبب الجواب باختصار"}]}
قواعد: ${count} أسئلة بالضبط · 4 خيارات لكل سؤال · "answer" رقم الخيار الصحيح (0-3) · "topic" موضوع مختصر بالعربي (مثل: الهندسة، التناظر اللفظي، الكيمياء العضوية) · "why" سطر واحد · لا تكرر سؤالاً · لا تخترع معلومات خارج المادة المعطاة.`;
    const { text, model } = await callAI([
      { role: "system", content: sys },
      { role: "user", content: `المادة:\n${source.slice(0, 14000)}\n\nولّد ${count} أسئلة.` },
    ], { maxTokens: 3000 });

    const parsed = extractJson(text);
    const qs = (parsed?.questions || (Array.isArray(parsed) ? parsed : []))
      .filter(q => q && q.q && Array.isArray(q.choices) && q.choices.length >= 2)
      .slice(0, count)
      .map((q, i) => ({
        i, q: String(q.q).slice(0, 600),
        choices: q.choices.slice(0, 4).map(c => String(c).slice(0, 300)),
        answer: Math.max(0, Math.min(q.choices.length - 1, Number(q.answer) || 0)),
        topic: String(q.topic || "عام").slice(0, 40),
        why: String(q.why || "").slice(0, 400),
      }));
    if (!qs.length) return res.status(502).json({ error: "AI couldn't build a clean test from that — try again or use a smaller file" });
    res.json({ questions: qs, title, model });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- submit a mock test: grade, predict score, remember ----------
app.post("/api/exam/submit", (req, res) => {
  const u = auth(req, res); if (!u) return;
  const qs = Array.isArray(req.body.questions) ? req.body.questions : [];
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (!qs.length) return res.status(400).json({ error: "no questions" });
  u.topicStats = u.topicStats || {};
  let correct = 0;
  const byTopic = {};
  qs.forEach((q, i) => {
    const ok = answers[i] === q.answer;
    if (ok) correct++;
    const t = String(q.topic || "عام").slice(0, 40);
    byTopic[t] = byTopic[t] || { correct: 0, total: 0 };
    byTopic[t].total++; if (ok) byTopic[t].correct++;
    u.topicStats[t] = u.topicStats[t] || { correct: 0, total: 0 };
    u.topicStats[t].total++; if (ok) u.topicStats[t].correct++;
  });
  const pct = correct / qs.length;
  // predicted Qiyas score: accuracy is the driver, nudged by how much they've actually studied
  const hoursWeek = Object.values(u.dayTotals || {}).slice(-7).reduce((a, b) => a + b, 0) / 3600;
  const effort = Math.max(-3, Math.min(5, (hoursWeek - 7) * 0.7));
  const history = u.exams || [];
  const raw = 32 + pct * 62 + effort;
  const score = Math.max(20, Math.min(99, Math.round(raw)));
  const attempt = {
    at: Date.now(), title: String(req.body.title || "اختبار تجريبي").slice(0, 60),
    exam: String(req.body.exam || "general").slice(0, 32),
    correct, total: qs.length, score,
    topics: Object.entries(byTopic).map(([t, v]) => ({ t, c: v.correct, n: v.total })),
  };
  u.exams = [...history, attempt].slice(-30);
  save();
  res.json({
    ...attempt,
    weak: weakTopics(u).slice(0, 5),
    prev: history.length ? history[history.length - 1].score : null,
    review: qs.map((q, i) => ({ i, q: q.q, choices: q.choices, answer: q.answer, mine: answers[i], why: q.why, topic: q.topic, ok: answers[i] === q.answer })),
  });
});

// ---------- photo question solver (vision) ----------
app.post("/api/ai/vision", async (req, res) => {
  const u = auth(req, res); if (!u) return;
  if (!AI_KEY) return res.status(503).json({ error: "AI not configured on this server" });
  if (!rateOk(u, res, 2)) return;
  const img = String(req.body.image || "");
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(img)) return res.status(400).json({ error: "send a png/jpeg/webp image" });
  if (img.length > 6e6) return res.status(400).json({ error: "Image too big — crop or shrink it" });
  try {
    const { text, model } = await callAI([{
      role: "user",
      content: [
        { type: "text", text: `أنت مدرّس اختبارات قياس. في هذه الصورة سؤال (أو أكثر). لكل سؤال: اذكر الجواب الصحيح بوضوح أولاً، ثم الشرح المختصر، ثم الشورت كت للحل السريع في الاختبار. ${String(req.body.note || "").slice(0, 300)} بدون مجاملات، ومن دون حشو. استخدم **عريض** و"- " فقط للتنسيق.` },
        { type: "image_url", image_url: { url: img } },
      ],
    }], { maxTokens: 1200, models: VISION_MODELS });
    res.json({ reply: text, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

loadDb().catch(e => console.error("db load failed, using in-memory:", e.message)).finally(() => {
  app.listen(PORT, () => console.log(`LockIn server on http://localhost:${PORT}${AI_KEY ? " (AI enabled)" : ""}${pgPool ? " (Postgres)" : ""}`));
});
