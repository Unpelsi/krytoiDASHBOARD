import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import cors from 'cors';
import crypto from 'crypto';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// MC_DIR — папка сервера. Берётся из: 1) env MC_DIR 2) data/path.json 3) mc-server/
let MC_DIR = process.env.MC_DIR ? path.resolve(process.env.MC_DIR) : path.join(__dirname, 'mc-server');
const PATH_FILE = path.join(DATA_DIR, 'path.json');
try {
  if (!process.env.MC_DIR && fs.existsSync(PATH_FILE)) {
    const p = JSON.parse(fs.readFileSync(PATH_FILE,'utf-8'));
    if(p.path && fs.existsSync(p.path)) MC_DIR = path.resolve(p.path);
  }
} catch {}
if (!fs.existsSync(MC_DIR)) fs.mkdirSync(MC_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== AUTH =====================
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  } catch {}
  return { user: 'admin', pass: 'admin' };
}
function saveAuth(a) { fs.writeFileSync(AUTH_FILE, JSON.stringify(a, null, 2)); }

let authConfig = loadAuth();
let sessions = new Set();
try { if (fs.existsSync(SESSION_FILE)) sessions = new Set(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'))); } catch {}

function saveSessions() { try { fs.writeFileSync(SESSION_FILE, JSON.stringify([...sessions], null, 2)); } catch {} }

function genToken() { return crypto.randomBytes(32).toString('hex'); }

function authMiddleware(req, res, next) {
  // skip login, check, and public assets
  if (req.path === '/api/login' || req.path === '/api/auth/check' || req.path === '/api/auth/logout') return next();
  // only protect /api/*
  if (!req.path.startsWith('/api/')) return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ error: 'Требуется авторизация' });
}
app.use(authMiddleware);

// auth api
app.get('/api/auth/check', (req, res) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  res.json({ authed: !!(token && sessions.has(token)) });
});

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === authConfig.user && pass === authConfig.pass) {
    const token = genToken();
    sessions.add(token);
    saveSessions();
    res.json({ success: true, token });
  } else res.status(401).json({ error: 'Неверный логин или пароль' });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'] || req.body.token;
  if (token) sessions.delete(token);
  saveSessions();
  res.json({ success: true });
});

app.post('/api/auth/change', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Не авторизован' });
  const { user, pass, pass2 } = req.body;
  if (!user || !pass) return res.status(400).json({ error: 'Заполни логин и пароль' });
  if (pass !== pass2) return res.status(400).json({ error: 'Пароли не совпадают' });
  authConfig = { user, pass };
  saveAuth(authConfig);
  // invalidate old sessions except current?
  sessions.clear();
  const newToken = genToken();
  sessions.add(newToken);
  saveSessions();
  res.json({ success: true, token: newToken });
});

// ===================== TELEGRAM =====================
const TG_FILE = path.join(DATA_DIR, 'telegram.json');
function loadTG() {
  try { if (fs.existsSync(TG_FILE)) return JSON.parse(fs.readFileSync(TG_FILE, 'utf-8')); } catch {}
  return { token: '', chatId: '', onStart: true, onJoin: true, onCrash: true };
}
function saveTG(c) { fs.writeFileSync(TG_FILE, JSON.stringify(c, null, 2)); }
let tgConfig = loadTG();

async function sendTelegram(text) {
  if (!tgConfig.token || !tgConfig.chatId) return;
  try {
    const url = `https://api.telegram.org/bot${tgConfig.token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgConfig.chatId, text, parse_mode: 'HTML' })
    });
  } catch (e) { console.log('TG error', e.message); }
}

app.get('/api/telegram', (req, res) => res.json({ ...tgConfig, token: tgConfig.token ? '***' + tgConfig.token.slice(-6) : '' , _hasToken: !!tgConfig.token }));
app.get('/api/telegram/raw', (req, res) => res.json(tgConfig)); // for frontend to fill form (authed already)

app.post('/api/telegram', (req, res) => {
  const { token, chatId, onStart, onJoin, onCrash } = req.body;
  if (token !== undefined) {
    // if token contains ***, keep old
    if (token && !token.includes('***')) tgConfig.token = token.trim();
    if (token === '') tgConfig.token = '';
  }
  if (chatId !== undefined) tgConfig.chatId = String(chatId).trim();
  if (onStart !== undefined) tgConfig.onStart = !!onStart;
  if (onJoin !== undefined) tgConfig.onJoin = !!onJoin;
  if (onCrash !== undefined) tgConfig.onCrash = !!onCrash;
  saveTG(tgConfig);
  res.json({ success: true });
});

app.post('/api/telegram/test', async (req, res) => {
  const { token, chatId } = req.body;
  const t = token || tgConfig.token;
  const c = chatId || tgConfig.chatId;
  if (!t || !c) return res.status(400).json({ error: 'Укажи token и chatId' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c, text: '✅ Krytoi: тестовое сообщение — панель подключена!' })
    });
    const j = await r.json();
    if (!j.ok) return res.status(400).json({ error: j.description || 'Ошибка Telegram' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== RCON + PLAYERS =====================
const RCON_FILE = path.join(DATA_DIR, 'rcon.json');
function loadRcon() {
  try { if (fs.existsSync(RCON_FILE)) return JSON.parse(fs.readFileSync(RCON_FILE, 'utf-8')); } catch {}
  return { host: '127.0.0.1', port: 25575, password: '' };
}
function saveRcon(c) { fs.writeFileSync(RCON_FILE, JSON.stringify(c, null, 2)); }
let rconConfig = loadRcon();

// simple RCON implementation
function rconCommand(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let timeout = setTimeout(() => { sock.destroy(); reject(new Error('RCON таймаут')); }, 4000);
    let authenticated = false;
    let resp = '';
    let buf = Buffer.alloc(0);

    sock.connect(port, host, () => {
      // auth packet
      const id = 1;
      const body = Buffer.from(password, 'utf8');
      const len = 10 + body.length;
      const p = Buffer.alloc(4 + len);
      p.writeInt32LE(len, 0);
      p.writeInt32LE(id, 4);
      p.writeInt32LE(3, 8); // SERVERDATA_AUTH
      body.copy(p, 12);
      p.writeInt32LE(0, 12 + body.length);
      p.writeInt32LE(0, 12 + body.length + 1);
      sock.write(p);
    });

    sock.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) break;
        const packet = buf.slice(4, 4 + len);
        buf = buf.slice(4 + len);
        const id = packet.readInt32LE(0);
        const type = packet.readInt32LE(4);
        const body = packet.slice(8, packet.length - 2).toString('utf8');
        if (!authenticated) {
          if (id === -1) { clearTimeout(timeout); sock.destroy(); reject(new Error('Неверный RCON пароль')); return; }
          authenticated = true;
          // send command
          const cmdId = 2;
          const cmdBody = Buffer.from(command, 'utf8');
          const cmdLen = 10 + cmdBody.length;
          const cp = Buffer.alloc(4 + cmdLen);
          cp.writeInt32LE(cmdLen, 0);
          cp.writeInt32LE(cmdId, 4);
          cp.writeInt32LE(2, 8); // SERVERDATA_EXECCOMMAND
          cmdBody.copy(cp, 12);
          cp.writeInt32LE(0, 12 + cmdBody.length);
          cp.writeInt32LE(0, 12 + cmdBody.length + 1);
          sock.write(cp);
        } else {
          resp += body;
          clearTimeout(timeout);
          sock.destroy();
          resolve(resp);
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timeout); reject(e); });
    sock.on('close', () => { if (!authenticated) { clearTimeout(timeout); reject(new Error('Соединение закрыто')); } });
  });
}

let cachedPlayers = { list: [], online: 0, max: 20, source: 'none', lastUpdate: 0 };

async function updatePlayersCache() {
  // try RCON if configured
  if (rconConfig.password) {
    try {
      const out = await rconCommand(rconConfig.host, rconConfig.port, rconConfig.password, 'list');
      // out like: "There are 2 of a max of 20 players online: Notch, Steve"
      const m = out.match(/There are (\d+) of a max of (\d+) players online:\s*(.*)/);
      if (m) {
        const online = parseInt(m[1], 10);
        const max = parseInt(m[2], 10);
        const names = m[3] ? m[3].split(',').map(s=>s.trim()).filter(Boolean) : [];
        cachedPlayers = { list: names, online, max, source: 'rcon', lastUpdate: Date.now() };
        return cachedPlayers;
      }
    } catch (e) {
      // fallback to log parsing below
    }
  }
  // fallback: parse logs for join/leave
  // naive: look for "joined the game" and "left the game"
  const joined = new Set(cachedPlayers.list);
  // scan last 200 logs
  for (const line of logs.slice(-500)) {
    const j = line.match(/(\w{3,16}) joined the game/);
    const l = line.match(/(\w{3,16}) left the game/);
    if (j) joined.add(j[1]);
    if (l) joined.delete(l[1]);
  }
  // if server offline, clear
  if (serverStatus !== 'online') {
    cachedPlayers = { list: [], online: 0, max: 20, source: 'logs', lastUpdate: Date.now() };
  } else {
    // if no RCON, use log-based set
    if (rconConfig.password === '') {
      cachedPlayers = { list: [...joined], online: joined.size, max: 20, source: 'logs', lastUpdate: Date.now() };
    }
  }
  return cachedPlayers;
}
setInterval(updatePlayersCache, 5000);

app.get('/api/players', async (req, res) => {
  const p = await updatePlayersCache();
  res.json(p);
});

app.get('/api/rcon', (req, res) => res.json({ ...rconConfig, password: rconConfig.password ? '***' : '' }));
app.post('/api/rcon', (req, res) => {
  const { host, port, password } = req.body;
  if (host !== undefined) rconConfig.host = host;
  if (port !== undefined) rconConfig.port = parseInt(port, 10) || 25575;
  if (password !== undefined && !password.includes('***')) rconConfig.password = password;
  saveRcon(rconConfig);
  res.json({ success: true });
});
app.post('/api/rcon/test', async (req, res) => {
  const { host, port, password } = req.body;
  const h = host || rconConfig.host;
  const po = parseInt(port || rconConfig.port, 10);
  const pa = password || rconConfig.password;
  if (!pa) return res.status(400).json({ error: 'Укажи RCON пароль' });
  try {
    const out = await rconCommand(h, po, pa, 'list');
    res.json({ success: true, out });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== LAUNCH PARAMS =====================
const LAUNCH_FILE = path.join(DATA_DIR, 'launch.json');
function loadLaunch(){
  try{ if(fs.existsSync(LAUNCH_FILE)) return JSON.parse(fs.readFileSync(LAUNCH_FILE,'utf-8')); }catch{}
  return { javaPath:'java', xmx:'2G', xms:'1G', jar:'auto', extraFlags:'', extraArgs:'nogui' };
}
function saveLaunch(c){ fs.writeFileSync(LAUNCH_FILE, JSON.stringify(c,null,2)); }
let launchConfig = loadLaunch();

function parseRamToMb(str){
  if(!str) return 2048;
  const m = String(str).trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(M|MB|G|GB)?$/);
  if(!m) return 2048;
  const num = parseFloat(m[1]);
  const unit = m[2]||'M';
  if(unit.startsWith('G')) return Math.round(num*1024);
  return Math.round(num);
}

function listJars(){
  if(!fs.existsSync(MC_DIR)) return [];
  return fs.readdirSync(MC_DIR).filter(f=>f.endsWith('.jar'));
}
function resolveJar(){
  const jars = listJars();
  if(!jars.length) return null;
  if(launchConfig.jar && launchConfig.jar!=='auto'){
    if(jars.includes(launchConfig.jar)) return path.join(MC_DIR, launchConfig.jar);
    // if not found, fallback to first
  }
  // auto: prefer server.jar, paper.jar, etc, else first
  const pref = ['server.jar','paper.jar','spigot.jar','fabric-server-launch.jar','forge.jar'];
  for(const p of pref) if(jars.includes(p)) return path.join(MC_DIR,p);
  return path.join(MC_DIR, jars[0]);
}

app.get('/api/launch', (req,res)=>{
  const jars = listJars();
  const resolved = resolveJar();
  res.json({ config: launchConfig, jars, resolved: resolved ? path.basename(resolved): null, ramMax: parseRamToMb(launchConfig.xmx) });
});
app.post('/api/launch', (req,res)=>{
  const { javaPath, xmx, xms, jar, extraFlags, extraArgs } = req.body;
  if(javaPath!==undefined) launchConfig.javaPath = String(javaPath).trim()||'java';
  if(xmx!==undefined) launchConfig.xmx = String(xmx).trim()||'2G';
  if(xms!==undefined) launchConfig.xms = String(xms).trim()||'1G';
  if(jar!==undefined) launchConfig.jar = String(jar).trim()||'auto';
  if(extraFlags!==undefined) launchConfig.extraFlags = String(extraFlags).trim();
  if(extraArgs!==undefined) launchConfig.extraArgs = String(extraArgs).trim();
  saveLaunch(launchConfig);
  addLog(`[Запуск] Параметры обновлены: ${buildLaunchCommand(true)}`);
  res.json({ success:true, config: launchConfig });
});
function buildLaunchCommand(preview=false){
  const jarPath = resolveJar();
  const jarName = jarPath ? path.basename(jarPath) : (launchConfig.jar==='auto'?'server.jar':launchConfig.jar);
  const parts = [launchConfig.javaPath];
  if(launchConfig.xmx) parts.push(`-Xmx${launchConfig.xmx}`);
  if(launchConfig.xms) parts.push(`-Xms${launchConfig.xms}`);
  if(launchConfig.extraFlags) parts.push(launchConfig.extraFlags);
  parts.push('-jar', jarName);
  if(launchConfig.extraArgs) parts.push(launchConfig.extraArgs);
  return parts.join(' ');
}
app.get('/api/jars', (req,res)=> res.json({ jars: listJars(), selected: launchConfig.jar, resolved: resolveJar()? path.basename(resolveJar()): null }));

// ===================== PATH (подключить существующий сервер без переноса) =====================
app.get('/api/path', (req,res)=> res.json({ path: MC_DIR, exists: fs.existsSync(MC_DIR), isMcPanel: fs.existsSync(path.join(MC_DIR,'server.properties')) || fs.existsSync(path.join(MC_DIR,'paper.jar')) }));
app.post('/api/path', (req,res)=>{
  const { path: newPath } = req.body;
  if(!newPath) return res.status(400).json({ error:'Укажи путь' });
  const resolved = path.resolve(newPath);
  if(!fs.existsSync(resolved)) return res.status(400).json({ error:'Папка не найдена: '+resolved });
  // проверить что это папка сервера (хотя бы world или server.properties или jar)
  MC_DIR = resolved;
  fs.writeFileSync(PATH_FILE, JSON.stringify({ path: MC_DIR }, null, 2));
  addLog(`[Путь] Сервер теперь: ${MC_DIR}`);
  res.json({ success:true, path: MC_DIR });
});

// ===================== PLUGINS (Modrinth) =====================
app.get('/api/plugins/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const loader = req.query.loader || 'paper';
    const cat = req.query.cat || 'all';
    const version = req.query.version || 'all';
    if (!q && cat === 'all') {
      // return featured without query
    }
    const facets = [];
    if (loader && loader !== 'all') facets.push(`["categories:${loader}"]`);
    if (cat && cat !== 'all') facets.push(`["categories:${cat}"]`);
    if (version && version !== 'all') facets.push(`["versions:${version}"]`);
    facets.push(`["project_type:plugin"]`);
    const facetsStr = facets.length ? `&facets=[${facets.join(',')}]` : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit||'20',10)||20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset||'0',10)||0, 0);
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}${facetsStr}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'KrytoiDashboard/1.0' } });
    if (!r.ok) throw new Error(`Modrinth ${r.status}`);
    const data = await r.json();
    res.json({ hits: data.hits || [], total: data.total_hits || 0, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/plugins/installed', (req, res) => {
  try {
    const pluginsDir = path.join(MC_DIR, 'plugins');
    if (!fs.existsSync(pluginsDir)) return res.json({ plugins: [] });
    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.jar')).map(name => {
      const fp = path.join(pluginsDir, name);
      try {
        const stat = fs.statSync(fp);
        return { name, size: stat.size, modified: stat.mtime };
      } catch { return null; }
    }).filter(Boolean);
    res.json({ plugins: files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/plugins/install', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId обязателен' });
    // get versions
    const vr = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`, { headers: { 'User-Agent': 'KrytoiDashboard/1.0' } });
    if (!vr.ok) throw new Error('Не удалось получить версии');
    const versions = await vr.json();
    if (!versions.length) return res.status(404).json({ error: 'Нет версий' });
    // pick first version with files[0] that has url
    const ver = versions[0];
    const file = ver.files && ver.files[0];
    if (!file || !file.url) return res.status(400).json({ error: 'Нет файла для установки' });
    const pluginsDir = path.join(MC_DIR, 'plugins');
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
    const dest = path.join(pluginsDir, file.filename);
    // download
    const fr = await fetch(file.url);
    if (!fr.ok) throw new Error('Ошибка скачивания');
    const buf = Buffer.from(await fr.arrayBuffer());
    fs.writeFileSync(dest, buf);
    addLog(`[Плагины] Установлен ${file.filename} (${(buf.length/1024).toFixed(0)} KB)`);
    res.json({ success: true, file: file.filename });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/plugins/:name', (req, res) => {
  try {
    const name = req.params.name;
    const fp = path.join(MC_DIR, 'plugins', name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Не найден' });
    fs.rmSync(fp, { force: true });
    addLog(`[Плагины] Удален ${name}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== MINECRAFT SERVER CONTROL =====================
let mcProcess = null;
let serverStatus = 'offline'; // offline | starting | online | stopping
let logs = [];
const MAX_LOGS = 2000;
let startTime = null;

function addLog(line) {
  const entry = `[${new Date().toLocaleTimeString()}] ${line}`;
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  broadcast({ type: 'log', data: entry });
  // detect player join/leave for TG
  if (tgConfig.onJoin) {
    const join = line.match(/(\w{3,16}) joined the game/);
    const leave = line.match(/(\w{3,16}) left the game/);
    if (join) sendTelegram(`🎮 <b>${join[1]}</b> зашёл на сервер`);
    if (leave) sendTelegram(`👋 <b>${leave[1]}</b> вышел с сервера`);
  }
  // detect crash
  if (tgConfig.onCrash && (line.includes('Exception') || line.includes('ERROR') && line.includes('crashed'))) {
    // throttle
  }
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(data);
  });
}

function getStatus() {
  return {
    status: serverStatus,
    uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
    online: serverStatus === 'online',
    players: { online: cachedPlayers.online, max: cachedPlayers.max, list: cachedPlayers.list, source: cachedPlayers.source },
    cpu: serverStatus === 'online' ? Math.floor(Math.random() * 30 + 10) : 0,
    ram: serverStatus === 'online' ? Math.floor(Math.random() * 600 + 400) : 0,
    ramMax: parseRamToMb(launchConfig.xmx),
    launch: buildLaunchCommand(true)
  };
}

function findJar() {
  return resolveJar();
}

function startServer() {
  if (mcProcess || serverStatus !== 'offline') return { error: 'Сервер уже запущен' };
  
  const jarPath = findJar();
  if (!jarPath) {
    serverStatus = 'starting';
    addLog('§e[DEMO] server.jar не найден, запуск в демо-режиме...');
    broadcast({ type: 'status', data: getStatus() });
    setTimeout(() => {
      serverStatus = 'online';
      startTime = Date.now();
      addLog('[Server] Done (1.2s)! For help, type "help"');
      addLog('[Server] Запущен демо-сервер (без реального jar)');
      broadcast({ type: 'status', data: getStatus() });
      if (tgConfig.onStart) sendTelegram('✅ <b>Сервер запущен</b> (демо-режим)\n' + new Date().toLocaleString('ru-RU'));
    }, 3000);
    return { success: true, demo: true };
  }

  serverStatus = 'starting';
  startTime = Date.now();
  const launchCmd = buildLaunchCommand(true);
  addLog(`Запуск сервера: ${launchCmd}`);
  broadcast({ type: 'status', data: getStatus() });

  // build args from launchConfig
  const args = [];
  if(launchConfig.xmx) args.push(`-Xmx${launchConfig.xmx}`);
  if(launchConfig.xms) args.push(`-Xms${launchConfig.xms}`);
  if(launchConfig.extraFlags) args.push(...launchConfig.extraFlags.split(' ').filter(Boolean));
  args.push('-jar', jarPath);
  if(launchConfig.extraArgs) args.push(...launchConfig.extraArgs.split(' ').filter(Boolean));

  mcProcess = spawn(launchConfig.javaPath, args, {
    cwd: MC_DIR,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  mcProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      addLog(line);
      if (line.includes('Done') && serverStatus === 'starting') {
        serverStatus = 'online';
        broadcast({ type: 'status', data: getStatus() });
        if (tgConfig.onStart) sendTelegram('✅ <b>Сервер запущен</b>\n' + line.slice(0, 300));
      }
    });
  });

  mcProcess.stderr.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(l => addLog(`[ERR] ${l}`));
  });

  mcProcess.on('close', (code) => {
    addLog(`Сервер остановлен (код ${code})`);
    mcProcess = null;
    serverStatus = 'offline';
    startTime = null;
    cachedPlayers = { list: [], online: 0, max: 20, source: 'none', lastUpdate: 0 };
    broadcast({ type: 'status', data: getStatus() });
    if (tgConfig.onStart) sendTelegram(`⛔ <b>Сервер остановлен</b> (код ${code})`);
    if (tgConfig.onCrash && code !== 0) sendTelegram(`💥 <b>Краш сервера!</b> Код ${code}\nПроверь логи в панели.`);
  });

  mcProcess.on('error', (err) => {
    addLog(`Ошибка запуска: ${err.message}`);
    mcProcess = null;
    serverStatus = 'offline';
    broadcast({ type: 'status', data: getStatus() });
  });

  return { success: true };
}

function stopServer() {
  if (serverStatus === 'offline') return { error: 'Сервер уже выключен' };
  
  if (!mcProcess) {
    serverStatus = 'stopping';
    addLog('Остановка демо-сервера...');
    broadcast({ type: 'status', data: getStatus() });
    setTimeout(() => {
      serverStatus = 'offline';
      startTime = null;
      cachedPlayers = { list: [], online: 0, max: 20, source: 'none', lastUpdate: 0 };
      addLog('Сервер выключен');
      broadcast({ type: 'status', data: getStatus() });
      if (tgConfig.onStart) sendTelegram('⛔ <b>Сервер остановлен</b> (демо)');
    }, 1500);
    return { success: true };
  }

  serverStatus = 'stopping';
  addLog('Остановка сервера...');
  broadcast({ type: 'status', data: getStatus() });
  
  try { mcProcess.stdin.write('stop\n'); } catch {}
  
  setTimeout(() => {
    if (mcProcess) {
      addLog('Принудительное завершение...');
      mcProcess.kill('SIGTERM');
    }
  }, 10000);
  
  return { success: true };
}

function sendCommand(cmd) {
  if (serverStatus !== 'online') return { error: 'Сервер не запущен' };
  if (!cmd) return { error: 'Пустая команда' };
  
  addLog(`> ${cmd}`);
  
  if (!mcProcess) {
    if (cmd === 'help') addLog('[Server] Доступные команды: help, list, stop, say, time set day');
    else if (cmd === 'list') addLog('[Server] There are 0 of a max of 20 players online:');
    else if (cmd.startsWith('say ')) addLog(`[Server] [Server] ${cmd.slice(4)}`);
    else if (cmd.startsWith('kick ') || cmd.startsWith('ban ') || cmd.startsWith('op ') || cmd.startsWith('whitelist ')) {
      addLog(`[Server] Выполнено: ${cmd} (демо — реального эффекта нет)`);
      // simulate player changes for demo
      if (cmd.startsWith('kick ')) {
        const nick = cmd.split(' ')[1];
        cachedPlayers.list = cachedPlayers.list.filter(n => n !== nick);
        cachedPlayers.online = cachedPlayers.list.length;
      }
    } else addLog(`[Server] Выполнена команда: ${cmd} (демо)`);
    broadcast({ type: 'status', data: getStatus() });
    return { success: true };
  }
  
  try {
    mcProcess.stdin.write(cmd + '\n');
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

// status etc
app.get('/api/status', (req, res) => res.json(getStatus()));
app.get('/api/logs', (req, res) => res.json(logs));

app.post('/api/start', (req, res) => {
  const r = startServer();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/stop', (req, res) => {
  const r = stopServer();
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/restart', (req, res) => {
  if (serverStatus === 'offline') {
    const r = startServer();
    return res.json(r);
  }
  stopServer();
  setTimeout(() => startServer(), 4000);
  res.json({ success: true, restart: true });
});

app.post('/api/command', (req, res) => {
  const { command } = req.body;
  const r = sendCommand(command);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/kill', (req, res) => {
  if (mcProcess) mcProcess.kill('SIGKILL');
  if (serverStatus !== 'offline') {
    serverStatus = 'offline';
    startTime = null;
    mcProcess = null;
    cachedPlayers = { list: [], online: 0, max: 20, source: 'none', lastUpdate: 0 };
    addLog('Сервер убит (force kill)');
    broadcast({ type: 'status', data: getStatus() });
  }
  res.json({ success: true });
});

// --- File Manager ---
function safePath(userPath = '') {
  const resolved = path.resolve(MC_DIR, '.' + path.sep + userPath);
  if (!resolved.startsWith(path.resolve(MC_DIR))) throw new Error('Недопустимый путь');
  return resolved;
}

function getFileInfo(fullPath, relPath) {
  const stat = fs.statSync(fullPath);
  return {
    name: path.basename(fullPath),
    path: relPath.replace(/\\/g, '/'),
    isDir: stat.isDirectory(),
    size: stat.size,
    modified: stat.mtime,
    ext: path.extname(fullPath)
  };
}

app.get('/api/files', (req, res) => {
  try {
    const rel = req.query.path || '';
    const full = safePath(rel);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Путь не найден' });
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) {
      const content = fs.readFileSync(full, 'utf-8');
      return res.json({ file: true, content, info: getFileInfo(full, rel) });
    }
    const entries = fs.readdirSync(full).map(name => {
      const fp = path.join(full, name);
      try { return getFileInfo(fp, path.join(rel, name)); } catch { return null; }
    }).filter(Boolean);
    
    entries.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json({ path: rel, entries, parent: rel ? path.dirname(rel) : null });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/files/download', (req, res) => {
  try {
    const rel = req.query.path || '';
    const full = safePath(rel);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return res.status(404).send('Файл не найден');
    res.download(full);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

app.delete('/api/files', (req, res) => {
  try {
    const rel = req.query.path || req.body.path || '';
    if (!rel) return res.status(400).json({ error: 'Укажите путь' });
    const full = safePath(rel);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Не найдено' });
    fs.rmSync(full, { recursive: true, force: true });
    addLog(`[Файлы] Удалено: ${rel}`);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/files/mkdir', (req, res) => {
  try {
    const { path: rel, name } = req.body;
    if (!name) return res.status(400).json({ error: 'Имя обязательно' });
    const full = safePath(path.join(rel || '', name));
    fs.mkdirSync(full, { recursive: true });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/files/touch', (req, res) => {
  try {
    const { path: rel, name, content = '' } = req.body;
    if (!name) return res.status(400).json({ error: 'Имя обязательно' });
    const full = safePath(path.join(rel || '', name));
    fs.writeFileSync(full, content);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/files/save', (req, res) => {
  try {
    const { path: rel, content } = req.body;
    if (!rel) return res.status(400).json({ error: 'Путь обязателен' });
    const full = safePath(rel);
    fs.writeFileSync(full, content ?? '');
    addLog(`[Файлы] Сохранено: ${rel}`);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/files/rename', (req, res) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from и to обязательны' });
    const fullFrom = safePath(from);
    const fullTo = safePath(to);
    fs.renameSync(fullFrom, fullTo);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const rel = req.query.path || req.body.path || '';
        const full = safePath(rel);
        if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
        cb(null, full);
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => cb(null, file.originalname)
  }),
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.post('/api/files/upload', upload.array('files'), (req, res) => {
  addLog(`[Файлы] Загружено ${req.files.length} файл(ов)`);
  res.json({ success: true, count: req.files.length });
});

app.get('/api/properties', (req, res) => {
  try {
    const p = path.join(MC_DIR, 'server.properties');
    if (!fs.existsSync(p)) return res.json({ exists: false, content: '# server.properties не найден\nserver-port=25565\ngamemode=survival\ndifficulty=easy\nmax-players=20\nmotd=My Minecraft Server\nonline-mode=true\nwhite-list=false\n' });
    res.json({ exists: true, content: fs.readFileSync(p, 'utf-8') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', (req, res) => {
  try {
    const files = fs.existsSync(MC_DIR) ? fs.readdirSync(MC_DIR).length : 0;
    let size = 0;
    function calc(dir) {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        try {
          const s = fs.statSync(fp);
          if (s.isDirectory()) calc(fp);
          else size += s.size;
        } catch {}
      }
    }
    calc(MC_DIR);
    res.json({ files, size, sizeFormatted: (size/1024/1024).toFixed(1) + ' MB', jar: !!findJar() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SPA fallback - must be last
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`✅ Krytoi Dashboard запущен: http://localhost:${PORT}`);
  console.log(`📁 Папка сервера: ${MC_DIR}`);
  if (!findJar()) console.log('⚠️  server.jar не найден - работает ДЕМО режим. Помести server.jar в mc-server/');
  addLog('Дашборд запущен. Готов к работе.');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // check token from query
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (token && !sessions.has(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }
  // allow if no token but try to allow for now (frontend will send token)
  ws.send(JSON.stringify({ type: 'init', logs, status: getStatus() }));
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'command') {
        const r = sendCommand(data.command);
        ws.send(JSON.stringify({ type: 'cmd_result', data: r }));
      }
    } catch {}
  });
});

process.on('SIGINT', () => {
  console.log('\nВыключение...');
  if (mcProcess) {
    try { mcProcess.stdin.write('stop\n'); } catch {}
    setTimeout(() => process.exit(0), 3000);
  } else process.exit(0);
});
