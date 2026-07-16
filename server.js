// LockIn server — single-file Express API with JSON-file storage.
// Run: node server.js  (PORT env optional, default 5050)
// Deploy free on Render/Railway, or one friend runs it and shares their address.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 5050;
const DB_FILE = path.join(process.env.DATA_DIR || __dirname, "db.json");

// ---------- storage (ponytail: JSON file + debounced save; move to sqlite if >50 users) ----------
let db = { users: {}, groups: {}, challenges: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DB_FILE, JSON.stringify(db)), 500);
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
  return gap <= 1 ? u.streak : 0; // streak survives until a full day is missed
}

// ---------- routes ----------
app.get("/api/health", (req, res) => res.json({ ok: true, app: "lockin" }));

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
    u.streak = u.lastStudyDay && daysBetween(u.lastStudyDay, d) === 1 ? u.streak + 1 : 1;
    u.lastStudyDay = d;
  }
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
      id: mu.id, name: mu.name, avatar: mu.avatar || 0, avatarImg: mu.avatarImg || null, coins: mu.coins, totalSeconds: mu.totalSeconds,
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
    return {
      code, name: g.name,
      members: g.members.map(pub).filter(Boolean),
      challenges: Object.values(db.challenges).filter(c => c.groupCode === code)
        .map(c => ({ ...c, winnerName: c.winner === "team" ? "team" : db.users[c.winner]?.name || null, streaks: c.type === "streak" ? Object.fromEntries(g.members.map(m => [m, currentStreak(db.users[m] || {})])) : undefined })),
    };
  }).filter(Boolean);
  res.json({ me: pub(u.id), groups });
});

// ---------- AI study assistant (OpenRouter proxy — key stays server-side) ----------
const AI_KEY = process.env.OPENROUTER_API_KEY ||
  (fs.existsSync(path.join(__dirname, "openrouter.key")) ? fs.readFileSync(path.join(__dirname, "openrouter.key"), "utf8").trim() : "");
const AI_MODELS = (process.env.AI_MODELS || "meta-llama/llama-3.3-70b-instruct:free,deepseek/deepseek-chat-v3-0324:free,google/gemini-2.0-flash-exp:free").split(",");
const aiUse = {}; // userId -> [timestamps], simple 30-req/hour limit

app.post("/api/ai", async (req, res) => {
  const u = auth(req, res); if (!u) return;
  if (!AI_KEY) return res.status(503).json({ error: "AI not configured on this server (set OPENROUTER_API_KEY)" });
  const now = Date.now();
  aiUse[u.id] = (aiUse[u.id] || []).filter(t => now - t < 3600e3);
  if (aiUse[u.id].length >= 30) return res.status(429).json({ error: "AI limit reached — try again in a bit" });
  aiUse[u.id].push(now);

  const history = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .slice(-12)
    .filter(m => ["user", "assistant"].includes(m.role))
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (!history.length) return res.status(400).json({ error: "no message" });
  const messages = [{
    role: "system",
    content: `You are the study assistant inside LockIn, a study-together app. The user is ${u.name}. Help them study: explain concepts clearly, quiz them, make study plans, summarize notes. Be concise and encouraging. Use plain text (no markdown headers).`,
  }, ...history];

  let lastErr = "AI unavailable";
  for (const model of AI_MODELS) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${AI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.trim(), messages, max_tokens: 800 }),
      });
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content;
      if (r.ok && text) return res.json({ reply: text, model: model.trim() });
      lastErr = j.error?.message || `model ${model.trim()} unavailable`;
    } catch (e) { lastErr = e.message; }
  }
  res.status(502).json({ error: lastErr });
});

app.listen(PORT, () => console.log(`LockIn server on http://localhost:${PORT}${AI_KEY ? " (AI enabled)" : ""}`));
