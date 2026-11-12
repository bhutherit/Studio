'use strict';
/* HJ Studio – Digital Album Maker (vanilla JS, History API router) */

const API = '/api';
const MAX_MB = 20; // lower to 10 on the free Cloudinary plan
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const EVENTS = ['Wedding', 'Engagement', 'Birthday', 'Pre-Wedding', 'Anniversary', 'Portfolio', 'Other'];
const THEMES = {
  ivory: { name: 'Ivory', cover: '#eadfc6', page: '#fbf8f2', ink: '#2b2823', accent: '#a9822f' },
  noir: { name: 'Noir', cover: '#1f1e1c', page: '#f4f0e8', ink: '#1f1e1c', accent: '#d2ad62' },
  rose: { name: 'Blush', cover: '#e6d2cc', page: '#fdf8f6', ink: '#4a3532', accent: '#a86f60' },
  sage: { name: 'Sage', cover: '#c9d2be', page: '#f8f9f4', ink: '#2f3a2d', accent: '#7f6f3a' },
  navy: { name: 'Midnight', cover: '#1c2438', page: '#f6f4ee', ink: '#1c2438', accent: '#d0ab5e' },
};
const NAV = [
  ['/admin', 'Dashboard'], ['/admin/albums', 'All albums'], ['/admin/create', 'Create album'],
  ['/admin/customers', 'Customers'], ['/admin/qr', 'QR generator'], ['/admin/settings', 'Settings'],
];
const state = { token: localStorage.getItem('hj_token'), settings: null };

/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString();
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const uid = () => Math.random().toString(36).slice(2, 10);
const variant = (url, t) => (url ? url.replace('/upload/', `/upload/${t}/`) : '');
const thumb = (u, w = 480) => variant(u, `f_auto,q_auto,c_limit,w_${w}`);
const large = (u, w = 1600) => variant(u, `f_auto,q_auto,c_limit,w_${w}`);
const dlUrl = (u, mode) => (mode === 'original' ? variant(u, 'fl_attachment') : variant(u, 'f_jpg,q_90,c_limit,w_2400,fl_attachment'));
const rawUrl = (u, mode) => (mode === 'original' ? u : variant(u, 'f_jpg,q_90,c_limit,w_2400'));
const albumUrl = (id) => ((state.settings && state.settings.siteUrl) || location.origin).replace(/\/+$/, '') + '/album/' + id;
const studioInfo = () => ({ name: state.settings?.studioName || 'HJ Studio', tagline: state.settings?.tagline || '', whatsapp: state.settings?.whatsapp || '' });

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}
let busy = 0;
function loading(on) { busy = Math.max(0, busy + (on ? 1 : -1)); document.body.classList.toggle('is-loading', busy > 0); }

async function api(name, { method = 'GET', query, body, auth = true } = {}) {
  loading(true);
  try {
    const qs = query ? '?' + new URLSearchParams(query) : '';
    const res = await fetch(`${API}/${name}${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth && state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error */ }
    if (res.status === 401 && auth && name !== 'auth-login') { logout(); throw new Error(data.error || 'Please sign in again.'); }
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Cannot reach the server. Check your connection and try again.');
    throw e;
  } finally { loading(false); }
}

function on(root, map) {
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const fn = map[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    if (el.dataset.busy) return;
    el.dataset.busy = '1';
    try { await fn(el, e); } catch (err) { toast(err.message || 'Something went wrong.', 'err'); } finally { delete el.dataset.busy; }
  });
}

function modal(html, { wide = false } = {}) {
  const el = document.createElement('div');
  el.className = 'modal-back';
  el.innerHTML = `<div class="modal glass ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modal-root').append(el);
  const api2 = { el, box: $('.modal', el), close: () => el.remove() };
  return api2;
}
function confirmBox(title, msg, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const m = modal(`<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="row end"><button class="btn ghost" data-r="0">Cancel</button><button class="btn danger" data-r="1">${esc(okLabel)}</button></div>`);
    const done = (v) => { m.close(); resolve(v); };
    m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === m.el) done(false); });
    $('[data-r="0"]', m.el).focus();
  });
}
function progressModal(title) {
  const m = modal(`<h3>${esc(title)}</h3><div class="bar"><i></i></div><p class="muted" style="margin:0">Starting…</p>`);
  return {
    set({ done, count, pct }) { $('.bar i', m.el).style.width = pct + '%'; $('p', m.el).textContent = `${done} of ${count} finished (${pct}%)`; },
    close: m.close,
  };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast('Link copied');
}
function saveUrl(url, name) {
  const a = document.createElement('a'); a.href = url; if (name) a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
}

/* ---------- routing ---------- */
let cleanup = null;
let renderId = 0;
const ROUTES = [
  [/^\/album\/([A-Za-z0-9]+)$/, publicAlbumPage, true],
  [/^\/admin$/, dashboardPage],
  [/^\/admin\/albums$/, albumsPage],
  [/^\/admin\/create$/, createPage],
  [/^\/admin\/edit\/([A-Za-z0-9]+)$/, editorPage],
  [/^\/admin\/customers$/, customersPage],
  [/^\/admin\/qr$/, qrPage],
  [/^\/admin\/settings$/, settingsPage],
];
function navigate(path) { history.pushState(null, '', path); render(); }
function logout() { state.token = null; localStorage.removeItem('hj_token'); if (location.pathname.startsWith('/admin')) render(); }

async function render() {
  const myId = ++renderId;
  if (cleanup) { cleanup(); cleanup = null; }
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') { history.replaceState(null, '', '/admin'); return render(); }
  const app = $('#app');
  for (const [re, fn, pub] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    if (pub) { const c = await fn(app, m.slice(1)); if (myId === renderId && typeof c === 'function') cleanup = c; else if (typeof c === 'function') c(); return; }
    if (!state.token) return loginView(app);
    if (!$('.shell')) {
      app.innerHTML = `<div class="shell"><aside class="side glass"><a class="brand" href="/admin" data-link><span class="mark">HJ</span><div><b>HJ Studio</b><small>Digital Album Maker</small></div></a><nav>${NAV.map(([h, l]) => `<a href="${h}" data-link>${l}</a>`).join('')}</nav><button class="btn ghost sm" id="logout">Sign out</button></aside><main class="main" id="page"></main></div>`;
      $('#logout').onclick = () => { logout(); };
    }
    if (!state.settings) { try { state.settings = (await api('settings')).settings; } catch (e) { if (!state.token) return; state.settings = {}; } }
    $$('.side nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === path || (path.startsWith('/admin/edit') && a.getAttribute('href') === '/admin/albums')));
    const fresh = document.createElement('main'); fresh.className = 'main'; fresh.id = 'page';
    fresh.innerHTML = '<div class="skeleton"></div>';
    $('#page').replaceWith(fresh);
    window.scrollTo(0, 0);
    try {
      const c = await fn(fresh, m.slice(1));
      if (typeof c === 'function') { if (myId === renderId) cleanup = c; else c(); }
    } catch (e) {
      fresh.innerHTML = `<div class="glass empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn dark" href="${esc(path)}" data-link>Try again</a></div>`;
    }
    return;
  }
  app.innerHTML = `<div class="login"><div class="glass login-card"><h1>Page not found</h1><p class="muted">Check the address and try again.</p><a class="btn dark" href="/admin" data-link>Go to dashboard</a></div></div>`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.target !== '_blank') { e.preventDefault(); navigate(a.getAttribute('href')); }
});
window.addEventListener('popstate', render);

/* ---------- login ---------- */
function loginView(app) {
  document.title = 'Sign in – HJ Studio';
  app.innerHTML = `<div class="login"><form class="glass login-card" id="lf"><div class="mark big">HJ</div><h1>HJ Studio</h1><p class="muted" style="margin-bottom:1.4rem">Sign in to manage your albums.</p>
  <label>Email<input name="email" type="email" required autocomplete="username"></label>
  <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
  <button class="btn gold" type="submit">Sign in</button><p class="err" id="lerr" role="alert"></p></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('button', f);
    btn.disabled = true; $('#lerr').textContent = '';
    try {
      const { token } = await api('auth-login', { method: 'POST', auth: false, body: { email: f.email.value, password: f.password.value } });
      state.token = token; localStorage.setItem('hj_token', token); state.settings = null;
      render();
    } catch (err) { $('#lerr').textContent = err.message; btn.disabled = false; }
  };
}

/* ---------- shared album UI ---------- */
function badgeFor(a) { return a.status !== 'published' ? ['draft', 'Draft'] : a.active ? ['live', 'Live'] : ['off', 'Link disabled']; }
function albumCard(a) {
  const [bc, bl] = badgeFor(a);
  const published = a.status === 'published';
  return `<article class="acard glass">
    <a class="acover" href="/admin/edit/${a.albumId}" data-link aria-label="Edit ${esc(a.title)}">${a.thumb ? `<img src="${thumb(a.thumb, 640)}" alt="" loading="lazy">` : '<span class="ph0">HJ</span>'}<span class="badge ${bc}">${bl}</span></a>
    <div class="abody"><h3>${esc(a.title)}</h3><p class="muted">${esc(a.customerName)}, ${esc(a.eventType)}</p>
    <p class="meta"><span>${fmt(a.photoCount)} photos</span><span>${fmt(a.views)} views</span><span>${fmtDate(a.createdAt)}</span></p>
    <div class="alink"><code>/album/${a.albumId}</code><button class="btn sm" data-act="copy" data-id="${a.albumId}">Copy</button></div>
    <div class="row wrap">
      ${published ? `<a class="btn sm" href="/album/${a.albumId}" target="_blank" rel="noopener">View</a>` : ''}
      <a class="btn sm" href="/admin/edit/${a.albumId}" data-link>Edit</a>
      ${published ? `<button class="btn sm" data-act="toggle" data-id="${a.albumId}" data-active="${a.active ? 1 : 0}">${a.active ? 'Disable link' : 'Reactivate'}</button><a class="btn sm" href="/admin/qr?id=${a.albumId}" data-link>QR</a>` : ''}
      <button class="btn sm danger" data-act="del" data-id="${a.albumId}" data-title="${esc(a.title)}">Delete</button>
    </div></div></article>`;
}
const albumHandlers = (reload) => ({
  copy: (el) => copyText(albumUrl(el.dataset.id)),
  toggle: async (el) => {
    const active = el.dataset.active !== '1';
    await api('albums', { method: 'PUT', query: { id: el.dataset.id }, body: { active } });
    toast(active ? 'Link reactivated' : 'Link disabled'); reload();
  },
  del: async (el) => {
    if (!(await confirmBox('Delete this album?', `"${el.dataset.title}" will be deleted for good, including its share link and all photos in cloud storage. This cannot be undone.`))) return;
    await api('albums', { method: 'DELETE', query: { id: el.dataset.id } });
    toast('Album deleted'); reload();
  },
});

/* ---------- dashboard ---------- */
async function dashboardPage(root) {
  document.title = 'Dashboard – HJ Studio';
  const load = async () => {
    const { stats, recent } = await api('albums', { query: { stats: 1 } });
    root.innerHTML = `<div class="page-head"><div><h1>Welcome back</h1><p class="muted">${esc(studioInfo().name)} at a glance.</p></div><a class="btn gold" href="/admin/create" data-link>Create album</a></div>
    <div class="stats">${[['Albums', stats.albums], ['Photos uploaded', stats.photos], ['Customers', stats.customers], ['Album views', stats.views]].map(([l, v]) => `<div class="stat glass"><b>${fmt(v)}</b><span>${l}</span></div>`).join('')}</div>
    <div class="section-title"><h2>Recently created</h2><a href="/admin/albums" data-link>View all albums</a></div>
    ${recent.length ? `<div class="agrid">${recent.map(albumCard).join('')}</div>` : `<div class="glass empty"><h2>No albums yet</h2><p>Create your first album to get a shareable link and QR code.</p><a class="btn gold" href="/admin/create" data-link>Create album</a></div>`}`;
  };
  on(root, albumHandlers(() => load().catch((e) => toast(e.message, 'err'))));
  await load();
}

/* ---------- all albums ---------- */
async function albumsPage(root) {
  document.title = 'All albums – HJ Studio';
  let albums = [];
  const draw = () => {
    const q = $('#q', root).value.trim().toLowerCase(), ev = $('#fe', root).value, st = $('#fs', root).value;
    const list = albums.filter((a) => (!q || `${a.title} ${a.customerName} ${a.albumId}`.toLowerCase().includes(q)) && (!ev || a.eventType === ev)
      && (!st || (st === 'draft' ? a.status !== 'published' : st === 'live' ? a.status === 'published' && a.active : a.status === 'published' && !a.active)));
    $('#list', root).innerHTML = list.length ? `<div class="agrid">${list.map(albumCard).join('')}</div>` : `<div class="glass empty"><h2>${albums.length ? 'No matching albums' : 'No albums yet'}</h2><p>${albums.length ? 'Try a different search or filter.' : 'Create an album to get started.'}</p>${albums.length ? '' : '<a class="btn gold" href="/admin/create" data-link>Create album</a>'}</div>`;
  };
  const load = async () => { albums = (await api('albums')).albums; draw(); };
  root.innerHTML = `<div class="page-head"><div><h1>All albums</h1><p class="muted">Search, share and manage every album.</p></div><a class="btn gold" href="/admin/create" data-link>Create album</a></div>
  <div class="toolbar"><input id="q" type="search" placeholder="Search by album, customer or ID" aria-label="Search albums">
  <select id="fe" aria-label="Event type"><option value="">All events</option>${EVENTS.map((e) => `<option>${e}</option>`).join('')}</select>
  <select id="fs" aria-label="Status"><option value="">All statuses</option><option value="live">Live</option><option value="off">Link disabled</option><option value="draft">Draft</option></select></div><div id="list"></div>`;
  ['input', 'change'].forEach((ev) => $('.toolbar', root).addEventListener(ev, draw));
  on(root, albumHandlers(() => load().catch((e) => toast(e.message, 'err'))));
  await load();
}

/* ---------- uploads (direct to Cloudinary with server-signed params) ---------- */
function checkFiles(files) {
  const good = [], bad = [];
  for (const f of files) {
    if (!ALLOWED.includes(f.type)) bad.push(`${f.name}: use JPG, PNG or WebP`);
    else if (f.size > MAX_MB * 1048576) bad.push(`${f.name}: larger than ${MAX_MB} MB`);
    else good.push(f);
  }
  if (bad.length) toast(`${bad.length} file(s) skipped. ${bad[0]}`, 'err');
  return good;
}
function uploadOne(file, sig, onP) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file); fd.append('api_key', sig.apiKey); fd.append('timestamp', sig.timestamp);
    fd.append('signature', sig.signature); fd.append('folder', sig.folder);
    const x = new XMLHttpRequest();
    x.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`);
    x.upload.onprogress = (e) => e.lengthComputable && onP(e.loaded);
    x.onload = () => {
      let r = {}; try { r = JSON.parse(x.responseText); } catch { /* ignore */ }
      if (x.status >= 200 && x.status < 300 && r.secure_url) resolve({ url: r.secure_url, publicId: r.public_id, width: r.width, height: r.height, bytes: r.bytes });
      else reject(new Error(r.error?.message || 'Upload failed'));
    };
    x.onerror = () => reject(new Error('Network error during upload'));
    x.send(fd);
  });
}
async function uploadFiles(albumId, files, onProgress) {
  const sig = await api('upload-sign', { method: 'POST', body: { albumId } });
  const out = new Array(files.length), loaded = new Array(files.length).fill(0);
  const total = files.reduce((s, f) => s + f.size, 0) || 1;
  let next = 0, done = 0;
  const report = () => onProgress({ done, count: files.length, pct: Math.min(100, Math.round(loaded.reduce((a, b) => a + b, 0) / total * 100)) });
  report();
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      try { out[i] = { ok: true, ...(await uploadOne(files[i], sig, (l) => { loaded[i] = l; report(); })) }; }
      catch (e) { out[i] = { ok: false, error: e.message, name: files[i].name }; }
      loaded[i] = files[i].size; done++; report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  return out;
}
const toPhoto = (r) => ({ id: uid(), url: r.url, publicId: r.publicId, width: r.width, height: r.height, bytes: r.bytes, caption: '', layout: 'single' });
const toImage = (r) => ({ url: r.url, publicId: r.publicId, width: r.width, height: r.height, bytes: r.bytes });
const themePicker = (cur) => `<div class="themes" role="radiogroup" aria-label="Album theme">${Object.entries(THEMES).map(([k, t]) => `<label class="theme"><input type="radio" name="theme" value="${k}" ${k === cur ? 'checked' : ''}><i style="background:linear-gradient(135deg,${t.cover} 50%,${t.page} 50%)"></i>${t.name}</label>`).join('')}</div>`;

/* ---------- create album ---------- */
async function createPage(root) {
  document.title = 'Create album – HJ Studio';
  let customers = [];
  try { customers = (await api('customers')).customers; } catch { /* optional */ }
  const s = state.settings || {};
  root.innerHTML = `<div class="page-head"><div><h1>Create album</h1><p class="muted">Add the details and photos. You can arrange pages in the editor next.</p></div></div>
  <form class="glass panel narrow" id="cf">
    <div class="grid2"><label>Album name<input name="title" type="text" required maxlength="120" placeholder="Aarav and Meera's Wedding"></label>
    <label>Customer name<input name="customerName" type="text" required maxlength="120" list="cl" autocomplete="off"></label></div>
    <datalist id="cl">${customers.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
    <div class="grid2"><label>Customer phone (optional)<input name="customerPhone" type="tel" maxlength="30" placeholder="+91 98765 43210"></label>
    <label>Event date (optional)<input name="eventDate" type="date"></label></div>
    <label>Event type<select name="eventType">${EVENTS.map((e) => `<option>${e}</option>`).join('')}</select></label>
    <label style="margin-bottom:.2rem">Album theme</label>${themePicker(s.defaultTheme || 'ivory')}
    <label class="drop"><strong>Album cover</strong><span class="muted">Choose one JPG, PNG or WebP (optional)</span><input type="file" id="cov" accept="image/jpeg,image/png,image/webp"></label>
    <div class="previews" id="covp"></div>
    <label class="drop" id="dz"><strong>Photos</strong><span class="muted">Click or drop photos here. Up to ${MAX_MB} MB each.</span><input type="file" id="pho" accept="image/jpeg,image/png,image/webp" multiple></label>
    <p class="hint" id="pcount">No photos selected</p><div class="previews" id="phop"></div>
    <div class="row end"><button class="btn gold" type="submit">Create album</button></div></form>`;
  let coverFile = null, photoFiles = [];
  const prev = (box, files) => { box.innerHTML = files.slice(0, 24).map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join(''); };
  $('#cov', root).onchange = (e) => { coverFile = checkFiles([...e.target.files])[0] || null; prev($('#covp', root), coverFile ? [coverFile] : []); };
  const setPhotos = (list) => { photoFiles = checkFiles(list); $('#pcount', root).textContent = photoFiles.length ? `${photoFiles.length} photo(s) selected` : 'No photos selected'; prev($('#phop', root), photoFiles); };
  $('#pho', root).onchange = (e) => setPhotos([...e.target.files]);
  const dz = $('#dz', root);
  dz.addEventListener('dragover', (e) => e.preventDefault());
  dz.addEventListener('drop', (e) => { e.preventDefault(); setPhotos([...e.dataTransfer.files]); });
  $('#cf', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('button[type=submit]', f);
    btn.disabled = true;
    let pm = null;
    try {
      const { album } = await api('albums', { method: 'POST', body: {
        title: f.title.value, customerName: f.customerName.value, customerPhone: f.customerPhone.value, eventDate: f.eventDate.value,
        eventType: f.eventType.value, theme: f.theme.value, downloadMode: s.defaultDownload || 'web' } });
      const files = [...(coverFile ? [coverFile] : []), ...photoFiles];
      if (files.length) {
        pm = progressModal('Uploading to cloud storage');
        const res = await uploadFiles(album.albumId, files, pm.set);
        pm.close(); pm = null;
        const okRes = res.filter((r) => r.ok);
        const body = {};
        if (coverFile && res[0].ok) body.cover = toImage(res[0]);
        body.photos = (coverFile ? res.slice(1) : res).filter((r) => r.ok).map(toPhoto);
        if (okRes.length) await api('albums', { method: 'PUT', query: { id: album.albumId }, body });
        const failed = res.length - okRes.length;
        if (failed) toast(`${failed} upload(s) failed. Add them again in the editor.`, 'err');
      }
      toast('Album created');
      navigate('/admin/edit/' + album.albumId);
    } catch (err) { if (pm) pm.close(); toast(err.message, 'err'); btn.disabled = false; }
  };
}

/* ---------- album editor ---------- */
async function editorPage(root, [id]) {
  let { album } = await api('albums', { query: { id } });
  let dirty = false;
  document.title = `Edit ${album.title} – HJ Studio`;
  root.innerHTML = `<div class="page-head"><div><h1>Album editor</h1><p class="muted" id="sub"></p></div>
    <div class="row wrap"><span class="muted" id="dirty"></span><button class="btn" data-act="preview">Preview</button><button class="btn dark" data-act="save">Save changes</button><button class="btn gold" data-act="publish"></button></div></div>
  <div class="editor"><form class="glass panel meta-panel" id="meta" onsubmit="return false">
    <label>Album name<input name="title" type="text" maxlength="120" required></label>
    <label>Customer name<input name="customerName" type="text" maxlength="120" required></label>
    <div class="grid2"><label>Phone<input name="customerPhone" type="tel" maxlength="30"></label><label>Event date<input name="eventDate" type="date"></label></div>
    <label>Event type<select name="eventType">${EVENTS.map((e) => `<option>${e}</option>`).join('')}</select></label>
    <label style="margin-bottom:.2rem">Theme</label><div id="themes"></div>
    <div class="cover-edit"><div id="covimg"></div><div><label class="btn sm" style="margin:0">Change cover<input type="file" id="covin" accept="image/jpeg,image/png,image/webp" hidden></label>
    <button type="button" class="btn sm ghost" data-act="rmcover">Remove</button></div></div>
    <label>Welcome note (title page)<textarea name="introText" maxlength="300" placeholder="Shown on the first page"></textarea></label>
    <label>Closing note (back cover)<textarea name="backText" maxlength="300" placeholder="Thank you for letting us be part of your story."></textarea></label>
    <label class="check"><input type="checkbox" name="showPageNumbers"> Show page numbers</label>
    <label class="check"><input type="checkbox" name="showCaptions"> Show captions</label>
    <label>Customer downloads<select name="downloadMode"><option value="off">Off</option><option value="web">Web size (2400 px)</option><option value="original">Original quality</option></select></label>
    <div class="sharebox" id="share"></div></form>
    <section class="glass panel"><div class="row between wrap" style="margin-bottom:.4rem"><h2 id="pt"></h2>
    <label class="btn gold sm" style="margin:0">Add photos<input type="file" id="addin" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div>
    <p class="hint">Drag photos to reorder, or use the arrows. "Spread" stretches a photo across both pages.</p><div class="pgrid" id="grid"></div></section></div>`;
  const form = $('#meta', root), grid = $('#grid', root);

  const fillForm = () => {
    ['title', 'customerName', 'customerPhone', 'eventDate', 'eventType', 'introText', 'backText', 'downloadMode'].forEach((k) => { form[k].value = album[k] || (k === 'downloadMode' ? 'web' : ''); });
    form.showPageNumbers.checked = album.showPageNumbers !== false; form.showCaptions.checked = album.showCaptions !== false;
    $('#themes', root).innerHTML = themePicker(album.theme);
  };
  const readForm = () => {
    ['title', 'customerName', 'customerPhone', 'eventDate', 'eventType', 'introText', 'backText', 'downloadMode'].forEach((k) => { album[k] = form[k].value; });
    album.showPageNumbers = form.showPageNumbers.checked; album.showCaptions = form.showCaptions.checked;
    album.theme = (form.theme && form.theme.value) || album.theme;
  };
  const mark = (d) => { dirty = d; $('#dirty', root).textContent = d ? 'Unsaved changes' : ''; };
  const drawHead = () => {
    const pub = album.status === 'published';
    $('#sub', root).textContent = `${album.albumId}, ${pub ? (album.active ? 'live' : 'link disabled') : 'draft'}`;
    $('[data-act=publish]', root).textContent = pub ? 'Unpublish' : 'Publish';
    $('#covimg', root).innerHTML = album.cover ? `<img src="${thumb(album.cover.url, 240)}" alt="Cover">` : '<div class="ph0" style="display:grid;place-items:center;color:var(--gold)">HJ</div>';
    const url = albumUrl(album.albumId);
    $('#share', root).innerHTML = pub ? `<code>${esc(url)}</code><div class="row wrap"><button type="button" class="btn sm" data-act="copy">Copy link</button><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">Open</a><a class="btn sm" href="/admin/qr?id=${album.albumId}" data-link>QR code</a><button type="button" class="btn sm" data-act="toggle">${album.active ? 'Disable link' : 'Reactivate link'}</button></div>`
      : '<p class="muted" style="margin:0">Publish this album to create its permanent link for customers.</p>';
  };
  const drawPhotos = () => {
    $('#pt', root).textContent = `Photos (${album.photos.length})`;
    grid.innerHTML = album.photos.length ? album.photos.map((p, i) => `<div class="ph" data-i="${i}"><div class="ph-img" draggable="true"><img src="${thumb(p.url, 360)}" alt="" loading="lazy"><span class="num">${i + 1}</span>${p.layout === 'spread' ? '<span class="tag">Spread</span>' : ''}</div>
      <div class="ph-body"><input class="cap" data-cap="${i}" value="${esc(p.caption)}" placeholder="Caption" maxlength="200" aria-label="Caption for photo ${i + 1}">
      <div class="ph-tools"><button type="button" class="btn sm" data-act="mv" data-i="${i}" data-d="-1" aria-label="Move earlier">&lsaquo;</button><button type="button" class="btn sm" data-act="mv" data-i="${i}" data-d="1" aria-label="Move later">&rsaquo;</button>
      <button type="button" class="btn sm" data-act="lay" data-i="${i}">${p.layout === 'spread' ? 'Single' : 'Spread'}</button><button type="button" class="btn sm danger" data-act="rm" data-i="${i}">Remove</button></div></div></div>`).join('')
      : '<p class="muted">No photos yet. Use Add photos to upload.</p>';
  };
  const move = (from, to) => {
    if (to < 0 || to >= album.photos.length || from === to) return;
    album.photos.splice(to, 0, album.photos.splice(from, 1)[0]); drawPhotos(); mark(true);
  };
  const save = async (silent) => {
    readForm();
    const b = ['title', 'customerName', 'customerPhone', 'eventType', 'eventDate', 'theme', 'cover', 'photos', 'showPageNumbers', 'showCaptions', 'downloadMode', 'status', 'active', 'introText', 'backText'];
    const body = {}; b.forEach((k) => { body[k] = album[k]; });
    album = (await api('albums', { method: 'PUT', query: { id }, body })).album;
    mark(false); drawHead(); if (!silent) toast('Changes saved');
  };
  const addImages = async (files, asCover) => {
    files = checkFiles(files); if (!files.length) return;
    const pm = progressModal(asCover ? 'Uploading cover' : 'Uploading photos');
    try {
      const res = await uploadFiles(id, files, pm.set);
      pm.close();
      const ok = res.filter((r) => r.ok);
      if (asCover && ok[0]) album.cover = toImage(ok[0]);
      else if (!asCover) album.photos.push(...ok.map(toPhoto));
      if (res.length > ok.length) toast(`${res.length - ok.length} upload(s) failed.`, 'err');
      if (ok.length) { readForm(); await save(true); drawPhotos(); toast(asCover ? 'Cover updated' : `${ok.length} photo(s) added`); }
    } catch (e) { pm.close(); throw e; }
  };

  fillForm(); drawHead(); drawPhotos(); mark(false);
  form.addEventListener('input', () => mark(true)); form.addEventListener('change', () => mark(true));
  grid.addEventListener('input', (e) => { const c = e.target.closest('[data-cap]'); if (c) { album.photos[+c.dataset.cap].caption = c.value; mark(true); } });
  $('#covin', root).onchange = (e) => addImages([...e.target.files], true).catch((er) => toast(er.message, 'err')).finally(() => { e.target.value = ''; });
  $('#addin', root).onchange = (e) => addImages([...e.target.files], false).catch((er) => toast(er.message, 'err')).finally(() => { e.target.value = ''; });
  let from = null;
  grid.addEventListener('dragstart', (e) => { const c = e.target.closest('.ph'); if (!c) return; from = +c.dataset.i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); c.classList.add('dragging'); });
  grid.addEventListener('dragover', (e) => { if (from === null) return; e.preventDefault(); $$('.ph.over', grid).forEach((x) => x.classList.remove('over')); const c = e.target.closest('.ph'); if (c) c.classList.add('over'); });
  grid.addEventListener('drop', (e) => { e.preventDefault(); const c = e.target.closest('.ph'); if (c && from !== null) move(from, +c.dataset.i); from = null; });
  grid.addEventListener('dragend', () => { from = null; $$('.ph.dragging,.ph.over', grid).forEach((x) => x.classList.remove('dragging', 'over')); });
  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  on(root, {
    mv: (el) => move(+el.dataset.i, +el.dataset.i + +el.dataset.d),
    lay: (el) => { const p = album.photos[+el.dataset.i]; p.layout = p.layout === 'spread' ? 'single' : 'spread'; drawPhotos(); mark(true); },
    rm: async (el) => { if (await confirmBox('Remove this photo?', 'It is deleted from cloud storage when you save.', 'Remove')) { album.photos.splice(+el.dataset.i, 1); drawPhotos(); mark(true); } },
    rmcover: () => { album.cover = null; drawHead(); mark(true); },
    save: () => save(false),
    preview: () => { readForm(); openPreview(album); },
    copy: () => copyText(albumUrl(album.albumId)),
    toggle: async () => { album.active = !album.active; await save(true); toast(album.active ? 'Link reactivated' : 'Link disabled'); },
    publish: async () => {
      if (album.status !== 'published' && !album.photos.length) throw new Error('Add at least one photo before publishing.');
      album.status = album.status === 'published' ? 'draft' : 'published'; if (album.status === 'published') album.active = true;
      await save(true); toast(album.status === 'published' ? 'Published. Your link is ready.' : 'Moved back to draft');
    },
  });
  return () => window.removeEventListener('beforeunload', beforeUnload);
}
function openPreview(album) {
  const layer = document.createElement('div');
  $('#modal-root').append(layer);
  const destroy = mountViewer(layer, album, studioInfo(), { onClose: () => { destroy(); layer.remove(); }, preview: true });
}

/* ---------- customers ---------- */
async function customersPage(root) {
  document.title = 'Customers – HJ Studio';
  let list = [];
  const draw = () => {
    const q = ($('#cq', root).value || '').toLowerCase();
    const rows = list.filter((c) => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));
    $('#ct', root).innerHTML = rows.length ? `<div class="trow head"><span>Name</span><span>Phone</span><span>Email</span><span>Albums</span><span></span></div>${rows.map((c) => `<div class="trow"><b>${esc(c.name)}</b><span class="c-phone">${esc(c.phone) || '-'}</span><span class="c-mail">${esc(c.email) || '-'}</span><span>${c.albumCount}</span><span class="row"><button class="btn sm" data-act="edit" data-id="${c.id}">Edit</button><button class="btn sm danger" data-act="del" data-id="${c.id}">Delete</button></span></div>`).join('')}`
      : `<div class="empty"><h2>${list.length ? 'No matching customers' : 'No customers yet'}</h2><p>Customers are added automatically when you create albums, or add one here.</p></div>`;
  };
  const load = async () => { list = (await api('customers')).customers; draw(); };
  const form = (c = {}) => {
    const m = modal(`<h3>${c.id ? 'Edit customer' : 'Add customer'}</h3><form id="cuf"><label>Name<input name="name" type="text" required maxlength="120" value="${esc(c.name)}"></label>
    <div class="grid2"><label>Phone<input name="phone" type="tel" maxlength="30" value="${esc(c.phone)}"></label><label>Email<input name="email" type="email" maxlength="120" value="${esc(c.email)}"></label></div>
    <label>Notes<textarea name="notes" maxlength="1000">${esc(c.notes)}</textarea></label><p class="err" id="cerr"></p>
    <div class="row end"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn gold" type="submit">Save customer</button></div></form>`, { wide: true });
    $('[data-x]', m.el).onclick = m.close;
    $('#cuf', m.el).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      try {
        await api('customers', { method: c.id ? 'PUT' : 'POST', query: c.id ? { id: c.id } : undefined, body: { name: f.name.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value } });
        m.close(); toast('Customer saved'); load();
      } catch (er) { $('#cerr', m.el).textContent = er.message; }
    };
  };
  root.innerHTML = `<div class="page-head"><div><h1>Customers</h1><p class="muted">Contact details for the people you shoot for.</p></div><button class="btn gold" data-act="add">Add customer</button></div>
  <div class="toolbar"><input id="cq" type="search" placeholder="Search customers" aria-label="Search customers"></div><div class="glass table" id="ct"></div>`;
  $('#cq', root).addEventListener('input', draw);
  on(root, {
    add: () => form(),
    edit: (el) => form(list.find((c) => c.id === el.dataset.id)),
    del: async (el) => {
      const c = list.find((x) => x.id === el.dataset.id);
      if (!(await confirmBox('Delete customer?', `${c.name} will be removed from your customer list. Their ${c.albumCount} album(s) are not deleted.`))) return;
      await api('customers', { method: 'DELETE', query: { id: c.id } }); toast('Customer deleted'); load();
    },
  });
  await load();
}

/* ---------- QR generator ---------- */
function qrCanvas(text, size) {
  const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(box);
  new QRCode(box, { text, width: size, height: size, colorDark: '#26241f', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  const c = box.querySelector('canvas'); box.remove(); return c;
}
function qrPng(a, url) {
  const q = qrCanvas(url, 900), c = document.createElement('canvas'); c.width = 1100; c.height = 1320;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1100, 1320); x.drawImage(q, 100, 100, 900, 900);
  x.textAlign = 'center'; x.fillStyle = '#26241f'; x.font = '600 62px Georgia, serif'; x.fillText(a.title.slice(0, 30), 550, 1100);
  x.fillStyle = '#a9822f'; x.font = '34px Arial, sans-serif'; x.fillText(url.replace(/^https?:\/\//, ''), 550, 1170);
  x.fillStyle = '#857e70'; x.font = '30px Arial, sans-serif'; x.fillText(studioInfo().name, 550, 1240);
  return c.toDataURL('image/png');
}
async function qrPage(root) {
  document.title = 'QR generator – HJ Studio';
  const albums = (await api('albums')).albums.filter((a) => a.status === 'published');
  const want = (new URLSearchParams(location.search).get('id') || '').toUpperCase();
  if (!albums.length) { root.innerHTML = `<div class="page-head"><h1>QR generator</h1></div><div class="glass empty"><h2>No published albums</h2><p>Publish an album to create its QR code.</p><a class="btn gold" href="/admin/albums" data-link>Go to albums</a></div>`; return; }
  root.innerHTML = `<div class="page-head"><div><h1>QR generator</h1><p class="muted">Print it on an invitation, frame or thank-you card.</p></div></div>
  <div class="qr-layout"><div class="glass panel"><label>Album<select id="qa">${albums.map((a) => `<option value="${a.albumId}" ${a.albumId === want ? 'selected' : ''}>${esc(a.title)} (${a.albumId})</option>`).join('')}</select></label>
  <p class="hint" id="qs"></p><div class="row wrap"><button class="btn gold" data-act="png">Download QR code</button><button class="btn" data-act="copy">Copy link</button><button class="btn" data-act="wa">Share on WhatsApp</button><a class="btn" id="qo" target="_blank" rel="noopener">Open album</a></div></div>
  <div class="glass qr-box"><img id="qi" alt="QR code for the album link"></div></div>`;
  const cur = () => albums.find((a) => a.albumId === $('#qa', root).value);
  const draw = () => { const a = cur(), url = albumUrl(a.albumId); $('#qi', root).src = qrCanvas(url, 600).toDataURL(); $('#qs', root).textContent = a.active ? url : 'This link is currently disabled. Customers will not be able to open it.'; $('#qo', root).href = url; };
  $('#qa', root).onchange = draw; draw();
  on(root, {
    png: () => { const a = cur(); saveUrl(qrPng(a, albumUrl(a.albumId)), `${a.albumId}-qr.png`); },
    copy: () => copyText(albumUrl(cur().albumId)),
    wa: async () => {
      const a = cur(); let phone = '';
      try { phone = ((await api('albums', { query: { id: a.albumId } })).album.customerPhone || '').replace(/[^\d]/g, ''); } catch { /* ignore */ }
      const text = `Hello ${a.customerName}, your album "${a.title}" is ready to view: ${albumUrl(a.albumId)}`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    },
  });
}

/* ---------- settings ---------- */
async function settingsPage(root) {
  document.title = 'Settings – HJ Studio';
  const s = (await api('settings')).settings; state.settings = s;
  root.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p class="muted">Studio details and album defaults.</p></div></div>
  <form class="glass panel narrow" id="sf"><div class="grid2"><label>Studio name<input name="studioName" type="text" maxlength="80" value="${esc(s.studioName)}" required></label>
  <label>Tagline<input name="tagline" type="text" maxlength="120" value="${esc(s.tagline)}"></label></div>
  <label>Studio WhatsApp number<input name="whatsapp" type="tel" maxlength="30" value="${esc(s.whatsapp)}" placeholder="+919876543210"></label>
  <label>Website address for share links<input name="siteUrl" type="url" maxlength="200" value="${esc(s.siteUrl)}" placeholder="https://albums.yourstudio.com"></label>
  <p class="hint">Leave empty to use this site's address (${esc(location.origin)}). Set it once your custom domain is connected.</p>
  <label style="margin-bottom:.2rem">Default theme for new albums</label>${themePicker(s.defaultTheme)}
  <label>Default customer downloads<select name="defaultDownload"><option value="off">Off</option><option value="web">Web size (2400 px)</option><option value="original">Original quality</option></select></label>
  <p class="err" id="serr"></p><div class="row end"><button class="btn gold" type="submit">Save settings</button></div></form>`;
  $('#sf', root).defaultDownload.value = s.defaultDownload || 'web';
  $('#sf', root).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; $('#serr', root).textContent = '';
    try {
      state.settings = (await api('settings', { method: 'PUT', body: { studioName: f.studioName.value, tagline: f.tagline.value, whatsapp: f.whatsapp.value, siteUrl: f.siteUrl.value, defaultTheme: f.theme.value, defaultDownload: f.defaultDownload.value } })).settings;
      toast('Settings saved');
    } catch (er) { $('#serr', root).textContent = er.message; }
  };
}

/* ====================== CUSTOMER ALBUM VIEWER ====================== */
async function publicAlbumPage(app, [id]) {
  document.title = 'Opening album – HJ Studio';
  app.innerHTML = '<div class="v-loading"><div class="spin"></div><p>Opening your album…</p></div>';
  let data;
  try {
    const first = !sessionStorage.getItem('seen_' + id);
    data = await api('public-album', { auth: false, query: { id, ...(first ? { count: 1 } : {}) } });
    sessionStorage.setItem('seen_' + id, '1');
  } catch (e) {
    app.innerHTML = `<div class="v-error"><h1>${e.status === 403 ? 'This link is turned off' : 'Album not found'}</h1><p>${esc(e.message)}</p></div>`;
    return;
  }
  document.title = `${data.album.title} – ${data.studio.name}`;
  return mountViewer(app, data.album, data.studio);
}

function buildSides(album) {
  const sides = [{ type: 'cover' }, { type: 'intro' }];
  const first = {};
  (album.photos || []).forEach((p) => {
    if (p.layout === 'spread') {
      if (sides.length % 2 === 0) sides.push({ type: 'blank' }); // spreads start on a left page
      first[p.id] = sides.length;
      sides.push({ type: 'half', p, half: 0 }, { type: 'half', p, half: 1 });
    } else { first[p.id] = sides.length; sides.push({ type: 'photo', p }); }
  });
  if (sides.length % 2 !== 0) sides.push({ type: 'blank' });
  sides.push({ type: 'inside' }, { type: 'back' });
  return { sides, first };
}

function sideHTML(s, idx, album, studio) {
  const num = idx - 1;
  const pn = album.showPageNumbers !== false && num > 0 && s.type !== 'blank' ? `<span class="pn ${idx % 2 ? 'l' : 'r'}">${num}</span>` : '';
  const cap = s.p && album.showCaptions !== false && s.p.caption ? esc(s.p.caption) : '';
  const date = album.eventDate ? fmtDate(album.eventDate) : '';
  switch (s.type) {
    case 'cover': return `<div class="cv ${album.cover ? 'has-img' : ''}">${album.cover ? `<img data-src="${large(album.cover.url, 1400)}" alt="">` : ''}<div class="cv-t"><h1>${esc(album.title)}</h1><p>${esc(album.customerName)}</p><small>${esc(studio.name)}</small></div></div>`;
    case 'intro': return `<div class="page-text"><small>${esc(studio.name)}</small><hr><h2>${esc(album.title)}</h2><p>${esc(album.customerName)}</p><p>${esc(album.eventType)}${date ? ', ' + esc(date) : ''}</p>${album.introText ? `<hr><p>${esc(album.introText)}</p>` : ''}</div>`;
    case 'photo': return `<figure class="pp"><img data-src="${large(s.p.url, 1500)}" alt="${cap}">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>${pn}`;
    case 'half': return `<div class="sp ${s.half ? 'r' : 'l'}"><img data-src="${large(s.p.url, 2600)}" alt="">${s.half && cap ? `<figcaption>${cap}</figcaption>` : ''}</div>${pn}`;
    case 'inside': return `<div class="page-text"><hr><p>${esc(album.backText || 'Thank you for letting us be part of your story.')}</p><hr><small>${esc(studio.name)}</small></div>`;
    case 'back': return `<div class="cv"><div class="cv-t"><p>${esc(studio.name)}</p>${studio.tagline ? `<small>${esc(studio.tagline)}</small>` : ''}${studio.whatsapp ? `<small>${esc(studio.whatsapp)}</small>` : ''}</div></div>`;
    default: return '';
  }
}

async function downloadZip(album, setStatus) {
  if (typeof JSZip === 'undefined') throw new Error('ZIP tool failed to load. Refresh and try again.');
  const mode = album.downloadMode, zip = new JSZip();
  const items = [...(album.cover ? [{ url: album.cover.url, name: `${album.albumId}-cover` }] : []), ...album.photos.map((p, i) => ({ url: p.url, name: `${album.albumId}-${String(i + 1).padStart(3, '0')}` }))];
  let done = 0;
  for (let i = 0; i < items.length; i += 4) {
    await Promise.all(items.slice(i, i + 4).map(async (it) => {
      const res = await fetch(rawUrl(it.url, mode));
      if (!res.ok) throw new Error('A photo could not be downloaded. Please try again.');
      const ext = mode === 'original' ? (it.url.split('.').pop().split('?')[0] || 'jpg') : 'jpg';
      zip.file(`${it.name}.${ext}`, await res.blob());
      setStatus(`Preparing ZIP: ${++done} of ${items.length}`);
    }));
  }
  setStatus('Building ZIP file…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const u = URL.createObjectURL(blob);
  saveUrl(u, `${album.title.replace(/[^\w-]+/g, '_')}-${album.albumId}.zip`);
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}

function mountViewer(root, album, studio, opts = {}) {
  const T = THEMES[album.theme] || THEMES.ivory;
  const { sides, first } = buildSides(album);
  const L = sides.length / 2;
  const canDl = album.downloadMode && album.downloadMode !== 'off';
  const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  root.innerHTML = `<div class="viewer" style="--cover:${T.cover};--page:${T.page};--ink:${T.ink};--accent:${T.accent}">
    <header class="v-top"><span class="v-brand">${esc(studio.name)}</span><span class="row"><button class="vbtn" data-v="gallery">Photos</button>${fsOk ? '<button class="vbtn" data-v="fs">Full screen</button>' : ''}${opts.onClose ? '<button class="vbtn" data-v="close">Close preview</button>' : ''}</span></header>
    <main class="v-stage"><button class="vbtn v-arrow prev" data-v="prev" aria-label="Previous page">&lsaquo;</button>
    <div class="book-wrap"><div class="book" id="book">${Array.from({ length: L }, (_, i) => `<div class="leaf"><div class="face front ${i === 0 ? 'cover' : ''}">${sideHTML(sides[2 * i], 2 * i, album, studio)}</div><div class="face back ${i === L - 1 ? 'cover' : ''}">${sideHTML(sides[2 * i + 1], 2 * i + 1, album, studio)}</div></div>`).join('')}</div></div>
    <button class="vbtn v-arrow next" data-v="next" aria-label="Next page">&rsaquo;</button></main>
    <footer class="v-bottom"><button class="vbtn" data-v="prev">Previous</button><span class="v-count" aria-live="polite"></span><button class="vbtn" data-v="next">Next</button></footer>
    <aside class="v-drawer" aria-label="Photos and downloads"><div class="v-dh"><div class="row between"><h3>Photos</h3><button class="vbtn" data-v="gallery">Close</button></div>
    ${canDl ? `<div class="row wrap"><button class="vbtn" data-v="zip">Download all (ZIP)</button>${album.cover ? '<button class="vbtn" data-v="dlcover">Download cover</button>' : ''}</div><p class="v-note">${album.downloadMode === 'original' ? 'Original quality files.' : 'Web size files (2400 px).'}</p>` : '<p class="v-note">Downloads are turned off for this album.</p>'}</div>
    <div class="v-dg">${album.photos.map((p, i) => `<div class="v-item" role="button" tabindex="0" data-v="go" data-i="${i}" aria-label="Go to photo ${i + 1}"><img src="${thumb(p.url, 320)}" alt="" loading="lazy">${canDl ? `<button class="vbtn dl" data-v="dl" data-i="${i}">Save</button>` : ''}</div>`).join('')}</div></aside></div>`;
  const v = $('.viewer', root), book = $('#book', root), stage = $('.v-stage', root), leaves = $$('.leaf', root);
  let cur = 0, timer = null, stepTimer = null;

  const z = (i, flipped) => { leaves[i].style.zIndex = flipped ? i + 1 : L - i; };
  leaves.forEach((_, i) => z(i, false));
  const hydrate = () => leaves.forEach((lf, i) => { if (i >= cur - 2 && i <= cur + 3) $$('img[data-src]', lf).forEach((im) => { im.src = im.dataset.src; im.removeAttribute('data-src'); }); });
  const update = () => {
    book.style.transform = cur === 0 ? 'translateX(-25%)' : cur === L ? 'translateX(25%)' : 'none';
    $('.v-count', root).textContent = cur === 0 ? 'Front cover' : cur === L ? 'Back cover' : `Spread ${cur} of ${L - 1}`;
    $$('[data-v=prev]', root).forEach((b) => { b.disabled = cur === 0; }); $$('[data-v=next]', root).forEach((b) => { b.disabled = cur === L; });
    hydrate();
  };
  const next = () => { if (cur >= L) return; const i = cur; leaves[i].style.zIndex = L + 5; leaves[i].classList.add('flipped'); setTimeout(() => z(i, true), 480); cur++; update(); };
  const prev = () => { if (cur <= 0) return; cur--; const i = cur; leaves[i].style.zIndex = L + 5; leaves[i].classList.remove('flipped'); setTimeout(() => z(i, false), 480); update(); };
  const goTo = (t) => { clearInterval(stepTimer); stepTimer = setInterval(() => { if (cur < t) next(); else if (cur > t) prev(); else clearInterval(stepTimer); }, 120); };
  const size = () => {
    const r = stage.getBoundingClientRect(), narrow = r.width < 700, ratio = 0.74;
    const ph = Math.max(180, Math.min(r.height - 28, ((r.width - (narrow ? 16 : 150)) / 2) / ratio));
    book.style.setProperty('--ph', ph + 'px'); book.style.setProperty('--pw', ph * ratio + 'px');
  };
  const pill = (msg) => { let p = $('.v-pill', v); if (!msg) { if (p) p.remove(); return; } if (!p) { p = document.createElement('div'); p.className = 'v-pill'; v.append(p); } p.textContent = msg; };
  const fs = () => { if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else (v.requestFullscreen || v.webkitRequestFullscreen).call(v); };
  const close = () => { opts.onClose && opts.onClose(); };

  const actions = {
    prev, next, close, fs, gallery: () => $('.v-drawer', root).classList.toggle('open'),
    go: (el) => { const p = album.photos[+el.dataset.i], s = first[p.id]; $('.v-drawer', root).classList.remove('open'); goTo(s % 2 ? (s + 1) / 2 : s / 2); },
    dl: (el) => { if (canDl) saveUrl(dlUrl(album.photos[+el.dataset.i].url, album.downloadMode)); },
    dlcover: () => { if (canDl && album.cover) saveUrl(dlUrl(album.cover.url, album.downloadMode)); },
    zip: async (el) => { if (!canDl) return; el.disabled = true; try { await downloadZip(album, pill); toast('Download started'); } catch (e) { toast(e.message, 'err'); } finally { pill(''); el.disabled = false; } },
  };
  v.addEventListener('click', (e) => {
    const el = e.target.closest('[data-v]');
    if (el) { e.stopPropagation(); const fn = actions[el.dataset.v]; if (fn) fn(el); return; }
    if (book.contains(e.target)) { const r = book.getBoundingClientRect(); (e.clientX < r.left + r.width / 2 ? prev : next)(); }
  });
  let tx = 0, ty = 0;
  stage.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) (dx < 0 ? next : prev)(); }, { passive: true });
  const keys = (e) => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); prev(); }
    else if (k === 'Home') goTo(0); else if (k === 'End') goTo(L);
    else if (k === 'f' || k === 'F') { if (fsOk) fs(); }
    else if (k === 'Escape') { const d = $('.v-drawer.open', root); if (d) d.classList.remove('open'); else if (opts.onClose) close(); }
  };
  document.addEventListener('keydown', keys);
  const ro = new ResizeObserver(size); ro.observe(stage);
  size(); update();
  timer = setTimeout(update, 50);
  return function destroy() {
    document.removeEventListener('keydown', keys); ro.disconnect(); clearTimeout(timer); clearInterval(stepTimer);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  };
}

render();
