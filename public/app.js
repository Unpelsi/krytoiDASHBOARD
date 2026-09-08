let ws;
let currentPath = '';
let status = { status: 'offline' };
let editorPath = '';
let cmdHistory = JSON.parse(localStorage.getItem('cmdHistory')||'[]');
let histIdx = cmdHistory.length;

// ===== AUTH =====
function getToken(){ return localStorage.getItem('krytoi_token')||''; }
function setToken(t){ localStorage.setItem('krytoi_token', t); }

async function checkAuth(){
  const token = getToken();
  if(!token){
    showLogin(); return false;
  }
  try{
    const r = await fetch('/api/auth/check', { headers:{'x-auth-token': token }});
    const j = await r.json();
    if(!j.authed){ showLogin(); return false; }
    hideLogin(); return true;
  }catch{ showLogin(); return false; }
}
function showLogin(){
  document.getElementById('loginScreen').classList.remove('hidden');
  document.querySelector('.app').style.display='none';
}
function hideLogin(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.querySelector('.app').style.display='';
}

async function doLogin(e){
  e.preventDefault();
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError');
  try{
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user, pass })});
    const j = await r.json();
    if(!r.ok) throw new Error(j.error);
    setToken(j.token);
    hideLogin();
    toast('Вход выполнен','success');
    initAfterAuth();
  }catch(e){
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}
async function doLogout(){
  const token = getToken();
  try{ await fetch('/api/auth/logout', { method:'POST', headers:{'x-auth-token': token, 'Content-Type':'application/json'} }); }catch{}
  localStorage.removeItem('krytoi_token');
  showLogin();
}
async function changeAuth(){
  const user = document.getElementById('authUser').value.trim();
  const pass = document.getElementById('authPass').value;
  const pass2 = document.getElementById('authPass2').value;
  const msg = document.getElementById('authMsg');
  try{
    const r = await api('/api/auth/change', { method:'POST', body:{ user, pass, pass2 }});
    setToken(r.token);
    msg.textContent = 'Логин/пароль сменён';
    msg.style.color = 'var(--green)';
    toast('Данные входа обновлены','success');
  }catch(e){ msg.textContent = e.message; msg.style.color='var(--red)'; }
}

// wrapper for auth
async function api(path, opts={}){
  const token = getToken();
  const headers = { 'Content-Type':'application/json', 'x-auth-token': token, ...(opts.headers||{}) };
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if(res.status===401){
    showLogin();
    throw new Error('Не авторизован');
  }
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}
async function apiRaw(path, opts={}){
  const token = getToken();
  const headers = { 'x-auth-token': token, ...(opts.headers||{}) };
  const res = await fetch(path, { ...opts, headers });
  if(res.status===401){ showLogin(); throw new Error('Не авторизован'); }
  return res;
}

// navigation
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

function switchPage(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
  const titles = {
    overview: ['Обзор', 'Управление твоим Minecraft сервером'],
    console: ['Консоль', 'Логи и команды сервера в реальном времени'],
    files: ['Файлы', 'Загружай, скачивай и редактируй файлы сервера'],
    plugins: ['Плагины', 'Моды и плагины с Modrinth — ставь в один клик'],
    settings: ['Настройки', 'Конфигурация и интеграции'],
    players: ['Игроки', 'Кто онлайн и управление правами']
  };
  const [t, s] = titles[name] || ['',''];
  document.getElementById('pageTitle').textContent = t;
  document.getElementById('pageSubtitle').textContent = s;
  if (name === 'files') loadFiles(currentPath);
  if (name === 'settings') { loadProps(); loadTelegram(); loadRcon(); loadLaunch(); loadPath(); }
  if (name === 'plugins') { loadInstalled(); if(!lastSearch.length) searchPlugins(1); }
  if (name === 'players') loadPlayers();
  history.replaceState(null,'','#'+name);
}
if (location.hash) {
  const p = location.hash.slice(1);
  if (document.querySelector(`[data-page="${p}"]`)) switchPage(p);
}

// toast
function toast(msg, type=''){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'), 3000);
}

// STATUS
async function fetchStatus(){
  try{
    const s = await api('/api/status');
    updateStatus(s);
    const st = await api('/api/stats');
    document.getElementById('jarInfo').textContent = st.jar ? '✅ найден' : '❌ не найден (демо)';
    document.getElementById('filesInfo').textContent = st.files + ' файлов';
    document.getElementById('sizeInfo').textContent = st.sizeFormatted;
    document.getElementById('demoAlert').style.display = st.jar ? 'none' : 'block';
  }catch(e){ console.error(e)}
}

function updateStatus(s){
  status = s;
  const card = document.getElementById('statusCard');
  const icon = document.getElementById('statusIcon');
  const label = document.getElementById('statusLabel');
  const uptime = document.getElementById('statusUptime');
  const miniDot = document.getElementById('miniDot');
  const miniStatus = document.getElementById('miniStatus');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnRestart = document.getElementById('btnRestart');
  const btnKill = document.getElementById('btnKill');

  card.className = 'status-card ' + s.status;
  miniDot.className = 'mini-dot ' + s.status;

  if(s.status === 'online'){
    label.textContent = 'В сети';
    icon.textContent = '●';
    uptime.textContent = `Работает ${formatUptime(s.uptime)} • Игроков: ${s.players.online}/${s.players.max}`;
    miniStatus.textContent = 'В сети';
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
    btnRestart.classList.remove('hidden');
    btnKill.classList.remove('hidden');
  } else if(s.status === 'starting' || s.status === 'stopping'){
    label.textContent = s.status === 'starting' ? 'Запускается...' : 'Останавливается...';
    icon.textContent = '◐';
    uptime.textContent = 'Подожди немного...';
    miniStatus.textContent = label.textContent;
    btnStart.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnRestart.classList.add('hidden');
    btnKill.classList.remove('hidden');
  } else {
    label.textContent = 'Выключен';
    icon.textContent = '○';
    uptime.textContent = 'Оффлайн — нажми Запустить';
    miniStatus.textContent = 'Оффлайн';
    btnStart.classList.remove('hidden');
    btnStop.classList.add('hidden');
    btnRestart.classList.add('hidden');
    btnKill.classList.add('hidden');
  }

  document.getElementById('playersCount').textContent = `${s.players.online} / ${s.players.max}`;
  document.getElementById('playersBar').style.width = (s.players.online / s.players.max * 100) + '%';
  document.getElementById('playersLiveHint').textContent = s.players.source === 'rcon' ? 'RCON' : s.players.source === 'logs' ? 'логи' : '';
  const hint = document.getElementById('playersListHint');
  if(s.players.list && s.players.list.length){
    hint.textContent = s.players.list.join(', ');
    renderAvatars(s.players.list);
  } else {
    hint.textContent = s.status==='online' ? 'никого нет' : 'сервер выключен';
    renderAvatars([]);
  }
  document.getElementById('cpuValue').textContent = s.cpu + '%';
  document.getElementById('cpuBar').style.width = s.cpu + '%';
  document.getElementById('cpuHint').textContent = s.online ? 'работает' : 'ожидание';
  document.getElementById('ramValue').textContent = `${s.ram} / ${s.ramMax} MB`;
  document.getElementById('ramBar').style.width = (s.ram / s.ramMax * 100) + '%';
  document.getElementById('ramHint').textContent = s.online ? 'используется' : 'не используется';

  // nav dot
  const dot = document.getElementById('navPlayersDot');
  if(s.players.online>0){ dot.classList.add('on'); } else dot.classList.remove('on');
  document.getElementById('serverIp').textContent = location.hostname + ':25565';
}

function renderAvatars(list){
  const c = document.getElementById('playersAvatars');
  if(!list.length){ c.innerHTML=''; return; }
  c.innerHTML = list.map(n=> `<img src="https://crafatar.com/avatars/${n}?size=32&overlay" title="${n}" onerror="this.style.display='none'">`).join('');
}

function formatUptime(sec){
  if(!sec) return '0с';
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  if(h) return `${h}ч ${m}м`;
  if(m) return `${m}м ${s}с`;
  return `${s}с`;
}

async function startServer(){
  try{ await api('/api/start', {method:'POST'}); toast('Запускаем сервер...','success'); }catch(e){ toast(e.message,'error')}
}
async function stopServer(){
  try{ await api('/api/stop', {method:'POST'}); toast('Останавливаем...'); }catch(e){ toast(e.message,'error')}
}
async function restartServer(){
  try{ await api('/api/restart', {method:'POST'}); toast('Перезапуск...'); }catch(e){ toast(e.message,'error')}
}
async function killServer(){
  if(!confirm('Принудительно убить процесс?')) return;
  await api('/api/kill', {method:'POST'}); toast('Убит','error');
}

function copyIp(){
  navigator.clipboard.writeText(document.getElementById('serverIp').textContent);
  toast('IP скопирован ✓','success');
}

// CONSOLE / WS
function connectWS(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onmessage = (e)=>{
    const msg = JSON.parse(e.data);
    if(msg.type === 'init'){
      updateStatus(msg.status);
      renderLogs(msg.logs);
    } else if(msg.type === 'log'){
      appendLog(msg.data);
    } else if(msg.type === 'status'){
      updateStatus(msg.data);
    }
  };
  ws.onclose = (e)=>{
    if(e.code===4001){ showLogin(); return; }
    setTimeout(connectWS, 2000);
  };
}

function renderLogs(logs){
  const c = document.getElementById('console');
  const mini = document.getElementById('miniLogs');
  c.textContent = logs.join('\n');
  mini.textContent = logs.slice(-20).join('\n') || 'Логов пока нет';
  autoScroll();
}
function appendLog(line){
  const c = document.getElementById('console');
  c.textContent += (c.textContent ? '\n' : '') + line;
  const mini = document.getElementById('miniLogs');
  const lines = c.textContent.split('\n').slice(-20);
  mini.textContent = lines.join('\n');
  autoScroll();
}
function autoScroll(){
  if(!document.getElementById('autoScroll').checked) return;
  const c = document.getElementById('console');
  c.scrollTop = c.scrollHeight;
}
function clearLogs(){
  document.getElementById('console').textContent = '';
}

document.getElementById('cmdInput').addEventListener('keydown', e=>{
  if(e.key === 'Enter'){
    sendCommand();
  } else if(e.key === 'ArrowUp'){
    e.preventDefault();
    if(histIdx>0){ histIdx--; e.target.value = cmdHistory[histIdx]||''; }
  } else if(e.key === 'ArrowDown'){
    e.preventDefault();
    if(histIdx < cmdHistory.length-1){ histIdx++; e.target.value = cmdHistory[histIdx]||''; } else { histIdx = cmdHistory.length; e.target.value=''; }
  }
});

async function sendCommand(){
  const input = document.getElementById('cmdInput');
  const cmd = input.value.trim();
  if(!cmd) return;
  // history
  cmdHistory.push(cmd);
  if(cmdHistory.length>100) cmdHistory.shift();
  localStorage.setItem('cmdHistory', JSON.stringify(cmdHistory));
  histIdx = cmdHistory.length;
  input.value = '';
  try{ await api('/api/command', {method:'POST', body:{command:cmd}}); }catch(e){ toast(e.message,'error'); appendLog(`[Ошибка] ${e.message}`)}
}
function sendQuick(cmd){ switchPage('console'); document.getElementById('cmdInput').value = cmd; sendCommand(); }
function prefillCmd(prefix){ switchPage('console'); const i=document.getElementById('cmdInput'); i.value=prefix; i.focus(); }

// FILES
async function loadFiles(p=''){
  currentPath = p;
  document.getElementById('pathDisplay').textContent = '/' + p;
  renderBreadcrumb(p);
  const list = document.getElementById('fileList');
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  try{
    const data = await api('/api/files?path=' + encodeURIComponent(p));
    if(data.file){
      openEditor(p, data.content);
      loadFiles(p.split('/').slice(0,-1).join('/'));
      return;
    }
    if(!data.entries.length){
      list.innerHTML = '<div class="empty">Папка пуста</div>';
      return;
    }
    list.innerHTML = '';
    for(const e of data.entries){
      const row = document.createElement('div');
      row.className = 'file-row';
      const isFolder = e.isDir;
      const size = isFolder ? 'Папка' : formatSize(e.size);
      const icon = isFolder ? 'DIR' : iconFor(e.ext);
      row.innerHTML = `
        <div class="file-icon ${isFolder?'folder':''}">${icon}</div>
        <div class="file-name"><b>${e.name}</b><span>${size} • ${new Date(e.modified).toLocaleString()}</span></div>
        <div class="file-actions">
          ${!isFolder ? `<a class="btn btn-sm btn-secondary" href="/api/files/download?path=${encodeURIComponent(e.path)}" download>Скачать</a>` : ''}
          ${!isFolder ? `<button class="btn btn-sm">Править</button>` : ''}
          <button class="btn btn-sm" style="color:var(--red)">Удалить</button>
        </div>
      `;
      row.addEventListener('click', (ev)=>{
        if(ev.target.closest('.file-actions')) return;
        if(isFolder) loadFiles(e.path);
        else openEditor(e.path);
      });
      if(isFolder){
        const del = row.querySelector('.file-actions .btn');
        del.onclick = async (ev)=>{ ev.stopPropagation(); if(confirm(`Удалить папку "${e.name}"?`)) await deletePath(e.path); };
      } else {
        const btns = row.querySelectorAll('.file-actions .btn');
        const edit = btns[1];
        const del = btns[2];
        if(edit) edit.onclick = (ev)=>{ ev.stopPropagation(); openEditor(e.path); };
        if(del) del.onclick = async (ev)=>{ ev.stopPropagation(); if(confirm(`Удалить "${e.name}"?`)) await deletePath(e.path); };
      }
      list.appendChild(row);
    }
  }catch(e){
    list.innerHTML = `<div class="empty">Ошибка: ${e.message}</div>`;
  }
}

function renderBreadcrumb(p){
  const bc = document.getElementById('breadcrumb');
  if(!p){ bc.innerHTML = '<a onclick="loadFiles(\'\')">/ (корень)</a>'; return; }
  const parts = p.split('/').filter(Boolean);
  let html = '<a onclick="loadFiles(\'\')">/ </a>';
  let acc = '';
  parts.forEach((part,i)=>{
    acc = acc ? acc + '/' + part : part;
    const cur = acc;
    html += ` / <a onclick="loadFiles('${cur}')">${part}</a>`;
  });
  bc.innerHTML = html;
}

function formatSize(b){
  if(b < 1024) return b + ' B';
  if(b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/1024/1024).toFixed(1) + ' MB';
}
function iconFor(ext){
  const map = {'.jar':'JAR','.json':'JSON','.yml':'YML','.yaml':'YML','.properties':'CFG','.log':'LOG','.txt':'TXT','.mcfunction':'MCF','.dat':'DAT','.lock':'LOCK'};
  return map[ext.toLowerCase()] || ext.replace('.','').toUpperCase().slice(0,3) || 'FILE';
}

function navigateUp(){
  if(!currentPath) return;
  const parent = currentPath.split('/').slice(0,-1).join('/');
  loadFiles(parent);
}
function refreshFiles(){ loadFiles(currentPath); }

async function deletePath(p){
  try{ await api('/api/files?path='+encodeURIComponent(p), {method:'DELETE'}); toast('Удалено','success'); loadFiles(currentPath); }catch(e){ toast(e.message,'error')}
}

async function createFolder(){
  const name = prompt('Имя папки:');
  if(!name) return;
  try{ await api('/api/files/mkdir', {method:'POST', body:{path:currentPath, name}}); loadFiles(currentPath); toast('Папка создана','success'); }catch(e){ toast(e.message,'error')}
}
async function createFile(){
  const name = prompt('Имя файла (например config.yml):');
  if(!name) return;
  try{ await api('/api/files/touch', {method:'POST', body:{path:currentPath, name, content:''}}); loadFiles(currentPath); toast('Файл создан','success'); openEditor((currentPath? currentPath+'/':'')+name); }catch(e){ toast(e.message,'error')}
}

async function uploadFiles(files){
  if(!files.length) return;
  const fd = new FormData();
  for(const f of files) fd.append('files', f);
  try{
    const token = getToken();
    const res = await fetch('/api/files/upload?path='+encodeURIComponent(currentPath), {method:'POST', headers:{'x-auth-token': token}, body:fd});
    if(!res.ok) throw new Error((await res.json()).error || 'Ошибка загрузки');
    toast(`Загружено ${files.length} файл(а)`, 'success');
    loadFiles(currentPath);
  }catch(e){ toast(e.message,'error')}
  document.getElementById('fileUpload').value = '';
}

// editor
async function openEditor(filePath, content){
  if(content === undefined){
    try{
      const data = await api('/api/files?path='+encodeURIComponent(filePath));
      if(!data.file) return;
      content = data.content;
    }catch(e){ toast(e.message,'error'); return; }
  }
  editorPath = filePath;
  document.getElementById('editorFileName').textContent = filePath;
  document.getElementById('editorArea').value = content;
  document.getElementById('editorModal').classList.remove('hidden');
}
function closeEditor(){ document.getElementById('editorModal').classList.add('hidden'); editorPath=''; }
async function saveFile(){
  const content = document.getElementById('editorArea').value;
  try{ await api('/api/files/save', {method:'POST', body:{path:editorPath, content}}); toast('Сохранено','success'); closeEditor(); loadFiles(currentPath); }catch(e){ toast(e.message,'error')}
}

// settings
async function loadProps(){
  try{
    const data = await api('/api/properties');
    document.getElementById('propsArea').value = data.content;
  }catch(e){ document.getElementById('propsArea').value = 'Ошибка: ' + e.message; }
}
async function saveProps(){
  const content = document.getElementById('propsArea').value;
  try{
    await api('/api/files/save', {method:'POST', body:{path:'server.properties', content}});
    toast('server.properties сохранён','success');
  }catch(e){ toast(e.message,'error')}
}

// ===== PLUGINS (живой поиск + бесконечная лента) =====
let lastSearch = [];
let pluginDebounce = null;
let pluginSearchGen = 0;
let pluginPage = 1;
let pluginTotal = 0;
let pluginLoading = false;
let pluginHasMore = true;
const PLUGIN_LIMIT = 20;
function filterCat(cat){
  document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('active', c.dataset.cat===cat));
  pluginPage = 1;
  pluginHasMore = true;
  searchPlugins(1, true);
}
async function searchPlugins(page, reset){
  if(page!==undefined) pluginPage = page;
  const isReset = reset!==false && page===1;
  if(isReset){ lastSearch = []; pluginHasMore = true; }
  const q = document.getElementById('pluginSearch').value.trim();
  const loader = document.getElementById('pluginLoader').value;
  const verEl = document.getElementById('pluginVersion');
  let version = verEl ? verEl.value : 'all';
  if(version==='custom'){
    const cus = document.getElementById('pluginVersionCustom');
    version = cus ? cus.value.trim() : '';
    if(!version) version='all';
  }
  const activeCat = document.querySelector('.chip.active')?.dataset.cat || 'all';
  const list = document.getElementById('pluginsList');
  const statusEl = document.getElementById('pluginsStatus');
  const info = document.getElementById('pluginsMoreInfo');
  const loadingEl = document.getElementById('pluginsLoading');
  const gen = ++pluginSearchGen;
  const offset = (pluginPage-1)*PLUGIN_LIMIT;
  if(pluginLoading) return;
  pluginLoading = true;
  if(isReset) list.innerHTML = '<div class="loading">Ищем на Modrinth...</div>';
  else if(loadingEl) loadingEl.style.display='block';
  if(statusEl) statusEl.textContent = 'ищем...';
  try{
    const r = await api(`/api/plugins/search?q=${encodeURIComponent(q)}&loader=${loader}&cat=${activeCat}&version=${encodeURIComponent(version)}&limit=${PLUGIN_LIMIT}&offset=${offset}`);
    if(gen !== pluginSearchGen) { pluginLoading=false; return; }
    const hits = r.hits || [];
    pluginTotal = r.total || 0;
    if(isReset){
      lastSearch = hits;
      if(!hits.length) list.innerHTML = '<div class="plugins-empty">Ничего не найдено. Попробуй другой запрос.</div>';
      else renderPlugins(hits);
    } else {
      lastSearch = lastSearch.concat(hits);
      appendPlugins(hits);
    }
    pluginHasMore = lastSearch.length < pluginTotal;
    if(statusEl) statusEl.textContent = `${pluginTotal.toLocaleString('ru-RU')} всего`;
    if(info) info.textContent = pluginHasMore ? `Показано ${lastSearch.length} из ${pluginTotal.toLocaleString('ru-RU')} — листай вниз` : `Показано все ${lastSearch.length} из ${pluginTotal.toLocaleString('ru-RU')}`;
  }catch(e){
    if(gen !== pluginSearchGen) { pluginLoading=false; return; }
    if(statusEl) statusEl.textContent = '';
    if(isReset) list.innerHTML = `<div class="plugins-empty">Ошибка: ${e.message}</div>`;
  } finally {
    pluginLoading = false;
    if(loadingEl) loadingEl.style.display='none';
  }
}
function loadNextPage(){
  if(pluginLoading || !pluginHasMore) return;
  pluginPage++;
  searchPlugins(pluginPage, false);
}
function debouncedSearch(){ clearTimeout(pluginDebounce); pluginDebounce = setTimeout(()=>{ pluginPage=1; searchPlugins(1, true); }, 400); }
setTimeout(()=>{
  const inp = document.getElementById('pluginSearch');
  const sel = document.getElementById('pluginLoader');
  const ver = document.getElementById('pluginVersion');
  const verCus = document.getElementById('pluginVersionCustom');
  if(inp) inp.addEventListener('input', debouncedSearch);
  if(sel) sel.addEventListener('change', ()=>{ pluginPage=1; searchPlugins(1, true); });
  if(ver) ver.addEventListener('change', ()=>{
    const isCustom = ver.value==='custom';
    if(verCus) verCus.style.display = isCustom ? '' : 'none';
    if(isCustom && verCus) verCus.focus();
    else { pluginPage=1; searchPlugins(1, true); }
  });
  if(verCus) verCus.addEventListener('input', debouncedSearch);
  // бесконечный скролл
  const sentinel = document.getElementById('pluginsSentinel');
  if(sentinel && 'IntersectionObserver' in window){
    const obs = new IntersectionObserver((entries)=>{
      if(entries[0].isIntersecting) loadNextPage();
    }, { rootMargin:'400px' });
    obs.observe(sentinel);
  } else {
    // fallback: scroll listener
    window.addEventListener('scroll', ()=>{
      if(window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) loadNextPage();
    });
  }
}, 500);
function renderPlugins(hits){
  const list = document.getElementById('pluginsList');
  list.innerHTML = hits.map(h=>`
    <div class="plugin-card">
      <div class="plugin-top">
        <div class="plugin-icon">${h.icon_url ? `<img src="${h.icon_url}">` : h.title.slice(0,2).toUpperCase()}</div>
        <div>
          <div class="plugin-name">${h.title}</div>
          <div class="plugin-author">by ${h.author}</div>
        </div>
      </div>
      <div class="plugin-desc">${h.description||''}</div>
      <div class="plugin-meta">
        <span>${(h.downloads||0).toLocaleString('ru-RU')}</span>
        <span>${(h.categories||[]).slice(0,2).join(' · ')}</span>
        ${(h.versions && h.versions.length) ? `<span title="${h.versions.join(', ')}">${h.versions.slice(-2).join(', ')}</span>` : ''}
      </div>
      <div class="plugin-actions">
        <button class="btn btn-primary btn-sm" onclick="installPlugin('${h.project_id}')">Установить</button>
        <a class="btn btn-secondary btn-sm" href="https://modrinth.com/plugin/${h.project_id}" target="_blank">Modrinth</a>
      </div>
    </div>
  `).join('');
}
function appendPlugins(hits){
  const list = document.getElementById('pluginsList');
  const html = hits.map(h=>`
    <div class="plugin-card">
      <div class="plugin-top">
        <div class="plugin-icon">${h.icon_url ? `<img src="${h.icon_url}">` : h.title.slice(0,2).toUpperCase()}</div>
        <div>
          <div class="plugin-name">${h.title}</div>
          <div class="plugin-author">by ${h.author}</div>
        </div>
      </div>
      <div class="plugin-desc">${h.description||''}</div>
      <div class="plugin-meta">
        <span>${(h.downloads||0).toLocaleString('ru-RU')}</span>
        <span>${(h.categories||[]).slice(0,2).join(' · ')}</span>
        ${(h.versions && h.versions.length) ? `<span title="${h.versions.join(', ')}">${h.versions.slice(-2).join(', ')}</span>` : ''}
      </div>
      <div class="plugin-actions">
        <button class="btn btn-primary btn-sm" onclick="installPlugin('${h.project_id}')">Установить</button>
        <a class="btn btn-secondary btn-sm" href="https://modrinth.com/plugin/${h.project_id}" target="_blank">Modrinth</a>
      </div>
    </div>
  `).join('');
  list.insertAdjacentHTML('beforeend', html);
}
async function installPlugin(id){
  if(!confirm('Установить плагин? Файл появится в plugins/, нужен рестарт сервера.')) return;
  try{
    toast('Ставим... подожди');
    const r = await api('/api/plugins/install', { method:'POST', body:{ projectId:id }});
    toast('Установлен: '+r.file, 'success');
    loadInstalled();
  }catch(e){ toast(e.message,'error'); }
}
async function loadInstalled(){
  try{
    const r = await api('/api/plugins/installed');
    const c = document.getElementById('installedPlugins');
    if(!r.plugins.length) c.innerHTML = '<div class="empty">Папка plugins пуста</div>';
    else c.innerHTML = r.plugins.map(p=>`
      <div class="installed-item">
        <span>🧩</span><code>${p.name}</code><span class="muted">${formatSize(p.size)}</span>
        <button class="btn btn-sm" style="color:var(--red)" onclick="removePlugin('${p.name}')">Удалить</button>
      </div>
    `).join('');
  }catch(e){ document.getElementById('installedPlugins').innerHTML = '<div class="empty">Ошибка: '+e.message+'</div>'; }
}
async function removePlugin(name){
  if(!confirm('Удалить '+name+'?')) return;
  await api('/api/plugins/'+encodeURIComponent(name), { method:'DELETE' });
  toast('Удалено','success'); loadInstalled();
}

// ===== PLAYERS RCON =====
async function loadPlayers(){
  try{
    const p = await api('/api/players');
    const listEl = document.getElementById('playersOnlineList');
    const badge = document.getElementById('playersOnlineBadge');
    badge.textContent = p.online + ' / ' + p.max;
    if(!p.list.length){
      listEl.innerHTML = '<div class="empty">Никто не онлайн ('+p.source+')</div>';
      return;
    }
    listEl.innerHTML = p.list.map(n=>`
      <div class="player-row">
        <img src="https://crafatar.com/avatars/${n}?size=32&overlay" onerror="this.src='https://crafatar.com/avatars/Steve?size=32'">
        <div style="flex:1"><b>${n}</b><br><span>в игре</span></div>
        <button class="btn btn-sm" onclick="prefillCmd('kick ${n} ')">Кик</button>
        <button class="btn btn-sm" onclick="prefillCmd('ban ${n} ')">Бан</button>
        <button class="btn btn-sm" onclick="prefillCmd('tp ${n} ')">ТП</button>
      </div>
    `).join('');
  }catch(e){ console.error(e); }
}
async function loadRcon(){
  try{
    const r = await api('/api/rcon');
    document.getElementById('rconHost').value = r.host||'';
    document.getElementById('rconPort').value = r.port||'';
    document.getElementById('rconPass').value = '';
    document.getElementById('rconStatus').textContent = r.password ? 'Пароль сохранён' : 'Не настроено';
  }catch{}
}
async function saveRcon(){
  const host = document.getElementById('rconHost').value.trim();
  const port = document.getElementById('rconPort').value.trim();
  const password = document.getElementById('rconPass').value;
  try{ await api('/api/rcon', { method:'POST', body:{ host, port, password }}); toast('RCON сохранён','success'); document.getElementById('rconStatus').textContent='Сохранено'; }catch(e){ toast(e.message,'error'); }
}
async function testRcon(){
  const host = document.getElementById('rconHost').value.trim();
  const port = document.getElementById('rconPort').value.trim();
  const password = document.getElementById('rconPass').value;
  try{ const r = await api('/api/rcon/test', { method:'POST', body:{ host, port, password }}); toast('RCON OK: '+r.out.slice(0,80),'success'); document.getElementById('rconStatus').textContent='OK: '+r.out.slice(0,80); }catch(e){ toast(e.message,'error'); document.getElementById('rconStatus').textContent='Ошибка: '+e.message; }
}

// ===== TELEGRAM =====
async function loadTelegram(){
  try{
    const r = await api('/api/telegram/raw');
    document.getElementById('tgToken').value = r.token||'';
    document.getElementById('tgChatId').value = r.chatId||'';
    document.getElementById('tgOnStart').checked = !!r.onStart;
    document.getElementById('tgOnJoin').checked = !!r.onJoin;
    document.getElementById('tgOnCrash').checked = !!r.onCrash;
    updateTgMini();
  }catch{}
}
function updateTgMini(){
  const has = document.getElementById('tgToken')?.value || document.getElementById('tgChatId')?.value;
  const el = document.getElementById('tgMiniStatus');
  if(el) el.textContent = has ? 'Telegram: настроен ✓' : 'Telegram: не настроен';
}
async function saveTelegram(){
  const token = document.getElementById('tgToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  const onStart = document.getElementById('tgOnStart').checked;
  const onJoin = document.getElementById('tgOnJoin').checked;
  const onCrash = document.getElementById('tgOnCrash').checked;
  const msg = document.getElementById('tgMsg');
  try{ await api('/api/telegram', { method:'POST', body:{ token: token.includes('***')?undefined:token, chatId, onStart, onJoin, onCrash }}); msg.textContent='Сохранено'; msg.style.color='var(--green)'; updateTgMini(); toast('Telegram сохранён','success'); }catch(e){ msg.textContent=e.message; msg.style.color='var(--red)'; }
}
async function testTelegram(){
  const token = document.getElementById('tgToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  try{ await api('/api/telegram/test', { method:'POST', body:{ token, chatId }}); toast('Сообщение отправлено в Telegram','success'); }catch(e){ toast(e.message,'error'); }
}

// ===== LAUNCH PARAMS =====
let launchLoaded = false;
async function loadLaunch(){
  try{
    const data = await api('/api/launch');
    const c = data.config;
    const jars = data.jars || [];
    // fill selects
    const xmxSel = document.getElementById('launchXmx');
    const xmxCus = document.getElementById('launchXmxCustom');
    const xmsSel = document.getElementById('launchXms');
    const xmsCus = document.getElementById('launchXmsCustom');
    const knownXmx = ['1G','2G','4G','6G','8G','12G','16G'];
    const knownXms = ['512M','1G','2G','4G'];
    if(knownXmx.includes(c.xmx)){ xmxSel.value=c.xmx; xmxCus.style.display='none'; }
    else { xmxSel.value='custom'; xmxCus.style.display=''; xmxCus.value=c.xmx; }
    if(knownXms.includes(c.xms)){ xmsSel.value=c.xms; xmsCus.style.display='none'; }
    else { xmsSel.value='custom'; xmsCus.style.display=''; xmsCus.value=c.xms; }
    document.getElementById('launchJava').value = c.javaPath||'java';
    document.getElementById('launchFlags').value = c.extraFlags||'';
    document.getElementById('launchArgs').value = c.extraArgs||'';
    // jar select
    const jarSel = document.getElementById('launchJar');
    jarSel.innerHTML = '<option value="auto">auto (выберет сам)</option>' + jars.map(j=> `<option value="${j}">${j}</option>`).join('');
    jarSel.value = c.jar||'auto';
    if(![...jarSel.options].some(o=>o.value===jarSel.value)){
      jarSel.innerHTML += `<option value="${c.jar}">${c.jar} (не найден)</option>`;
      jarSel.value=c.jar;
    }
    document.getElementById('jarsInfo').textContent = jars.length ? jars.join(', ') : 'нет jar';
    previewLaunch();
    launchLoaded = true;
    // listeners for custom
    xmxSel.onchange = ()=>{
      if(xmxSel.value==='custom'){ xmxCus.style.display=''; xmxCus.focus(); } else { xmxCus.style.display='none'; }
      previewLaunch();
    };
    xmsSel.onchange = ()=>{
      if(xmsSel.value==='custom'){ xmsCus.style.display=''; xmsCus.focus(); } else { xmsCus.style.display='none'; }
      previewLaunch();
    };
  }catch(e){ console.error('loadLaunch',e); }
}
function getLaunchForm(){
  const xmxSel = document.getElementById('launchXmx').value;
  const xmxCus = document.getElementById('launchXmxCustom').value.trim();
  const xmsSel = document.getElementById('launchXms').value;
  const xmsCus = document.getElementById('launchXmsCustom').value.trim();
  const xmx = xmxSel==='custom' ? xmxCus : xmxSel;
  const xms = xmsSel==='custom' ? xmsCus : xmsSel;
  return {
    javaPath: document.getElementById('launchJava').value.trim()||'java',
    xmx: xmx||'2G',
    xms: xms||'1G',
    jar: document.getElementById('launchJar').value,
    extraFlags: document.getElementById('launchFlags').value.trim(),
    extraArgs: document.getElementById('launchArgs').value.trim()
  };
}
function previewLaunch(){
  const c = getLaunchForm();
  const jarName = c.jar==='auto' ? '(auto)' : c.jar;
  let cmd = `${c.javaPath} -Xmx${c.xmx} -Xms${c.xms}`;
  if(c.extraFlags) cmd+= ' ' + c.extraFlags;
  cmd+= ` -jar ${jarName}`;
  if(c.extraArgs) cmd+= ' ' + c.extraArgs;
  const el = document.getElementById('launchPreview');
  if(el) el.textContent = cmd;
}
async function saveLaunch(){
  const body = getLaunchForm();
  const msg = document.getElementById('launchMsg');
  try{
    await api('/api/launch', { method:'POST', body });
    msg.textContent='Сохранено ✓';
    msg.style.color='var(--green)';
    toast('Параметры запуска сохранены','success');
  }catch(e){ msg.textContent=e.message; msg.style.color='var(--red)'; toast(e.message,'error'); }
}
function copyLaunch(){
  const t = document.getElementById('launchPreview').textContent;
  navigator.clipboard.writeText(t);
  toast('Скопировано','success');
}

// ===== PATH (подключить существующий сервер) =====
async function loadPath(){
  try{
    const r = await api('/api/path');
    document.getElementById('currentPath').textContent = r.path;
    document.getElementById('newPath').placeholder = r.path;
    // обнови инфо на обзоре
    const hint = document.getElementById('jarsInfo');
    if(hint) hint.textContent = r.path;
  }catch(e){ document.getElementById('currentPath').textContent = 'Ошибка: '+e.message; }
}
async function savePath(){
  const p = document.getElementById('newPath').value.trim();
  const msg = document.getElementById('pathMsg');
  if(!p){ msg.textContent='Вставь путь к папке'; msg.style.color='var(--red)'; return; }
  try{
    const r = await api('/api/path', { method:'POST', body:{ path: p }});
    msg.textContent='Подключено: '+r.path; msg.style.color='var(--green)';
    toast('Папка подключена','success');
    document.getElementById('currentPath').textContent = r.path;
    loadFiles('');
    loadLaunch();
    fetchStatus();
  }catch(e){ msg.textContent=e.message; msg.style.color='var(--red)'; toast(e.message,'error'); }
}

// init
async function initAfterAuth(){
  fetchStatus();
  setInterval(fetchStatus, 3000);
  setInterval(loadPlayers, 4000);
  connectWS();
  loadFiles('');
  loadInstalled();
  loadPlayers();
  loadTelegram();
  loadRcon();
  loadLaunch();
  loadPath();
}

(async()=>{
  const ok = await checkAuth();
  if(ok) initAfterAuth();
})();
