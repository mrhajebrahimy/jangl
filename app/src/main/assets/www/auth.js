/* Aria Edit — local accounts (device-only).
 * Passwords are never stored: only PBKDF2-HMAC-SHA256 hash + random salt.
 * This is on-device separation of profiles, NOT server-side authentication. */
(function () {
  'use strict';
  var USERS_KEY = 'aria_users_v1', SESSION_KEY = 'aria_session_v1';
  var LEGACY_KEY = 'editquest_state_v1', SCRATCH_KEY = 'aria_scratch_nosession';
  var ITER = 600000, SESSION_MS = 30 * 24 * 3600 * 1000;
  var MAX_FAILS = 5, enc = new TextEncoder();
  var API = String(window.ARIA_API_BASE || '').replace(/\/+$/, ''), SERVER = !!API, SRV_KEY = 'aria_srv_v1';
  var srv = SERVER ? read(SRV_KEY, null) : null;

  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function users() { var u = read(USERS_KEY, []); return Array.isArray(u) ? u : []; }
  function norm(n) { return String(n || '').normalize('NFKC').trim().toLowerCase(); }
  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function hex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }
  function safeEq(a, b) { if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
  async function derive(pw, salt, iter) {
    var key = await crypto.subtle.importKey('raw', enc.encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, key, 256));
  }
  function validName(n) { return /^(?=.{3,24}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u.test(n); }
  function validPw(p, n) {
    if (p.length < 8) return 'رمز عبور باید حداقل ۸ کاراکتر باشد.';
    if (p.length > 128) return 'رمز عبور خیلی طولانی است.';
    if (norm(p) === norm(n)) return 'رمز عبور نباید با نام کاربری یکی باشد.';
    if (/^(.)\1+$/.test(p)) return 'رمز عبور بیش از حد ساده است.';
    return '';
  }

  var me = null;
  if (SERVER) {
    if (srv && srv.refresh && srv.uid) { me = { id: srv.uid, username: srv.username }; localStorage.removeItem(SCRATCH_KEY); }
  } else {
    var sess = read(SESSION_KEY, null);
    if (sess && (!sess.exp || sess.exp < Date.now() || !users().some(function (u) { return u.id === sess.uid; }))) { localStorage.removeItem(SESSION_KEY); sess = null; }
    if (sess) { sess.exp = Date.now() + SESSION_MS; write(SESSION_KEY, sess); localStorage.removeItem(SCRATCH_KEY); }
    me = sess ? users().filter(function (u) { return u.id === sess.uid; })[0] : null;
  }

  /* ---------- server mode (optional): accounts + per-user progress live on the Aria Edit API ---------- */
  var refreshing = null, lastSynced = null, ver = 0, timer = null;
  function stateKey() { return 'aria_state_v2_' + (me && me.id); }
  function verKey() { return 'aria_srv_ver_' + (me && me.id); }
  function syncedKey() { return 'aria_srv_synced_' + (me && me.id); }
  function setSrv(j) { srv = { uid: j.user.id, username: j.user.username, access: j.accessToken, refresh: j.refreshToken }; write(SRV_KEY, srv); }
  async function call(method, path, body, auth) {
    var h = {}; if (body) h['Content-Type'] = 'application/json'; if (auth && srv) h.Authorization = 'Bearer ' + srv.access;
    var r = await fetch(API + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' });
    var j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, json: j, retry: r.headers.get('Retry-After') };
  }
  function refreshTokens() {
    if (!refreshing) refreshing = call('POST', '/api/auth/refresh', { refreshToken: srv.refresh }).then(function (r) {
      if (r.status === 200) { setSrv(r.json); return true; }
      if (r.status === 401) { localStorage.removeItem(SRV_KEY); srv = null; location.reload(); }
      return false;
    }).finally(function () { refreshing = null; });
    return refreshing;
  }
  async function authed(method, path, body) {
    var r = await call(method, path, body, true);
    if (r.status === 401 && srv && await refreshTokens()) r = await call(method, path, body, true);
    return r;
  }
  async function pushNow() {
    if (!SERVER || !me || window.__ARIA_NOSAVE) return;
    var ls = localStorage.getItem(stateKey()); if (!ls || ls === lastSynced) return;
    try {
      var r = await authed('PUT', '/api/state', { baseVersion: ver, state: JSON.parse(ls) });
      if (r.status === 409) { ver = r.json.error.version; r = await authed('PUT', '/api/state', { baseVersion: ver, state: JSON.parse(ls) }); } // this device wins on concurrent edits
      if (r.status === 200) { ver = r.json.version; lastSynced = ls; localStorage.setItem(verKey(), String(ver)); localStorage.setItem(syncedKey(), ls); }
    } catch (e) { /* offline: retried on next save */ }
  }
  async function startupSync() {
    ver = parseInt(localStorage.getItem(verKey()) || '0', 10) || 0; lastSynced = localStorage.getItem(syncedKey());
    try {
      var r = await authed('GET', '/api/state'); if (r.status !== 200) return;
      var local = localStorage.getItem(stateKey());
      if (r.json.state && r.json.version > ver && (!local || local === lastSynced)) { // server is newer and local is untouched: adopt it
        var str = JSON.stringify(r.json.state); localStorage.setItem(stateKey(), str); localStorage.setItem(syncedKey(), str); localStorage.setItem(verKey(), String(r.json.version));
        window.__ARIA_NOSAVE = true; location.reload(); return;
      }
      ver = r.json.version; localStorage.setItem(verKey(), String(ver)); await pushNow();
    } catch (e) {}
  }
  function srvErr(r) {
    var c = r.json && r.json.error && r.json.error.code;
    var m = { username_taken: 'این نام کاربری قبلاً گرفته شده است.', invalid_username: 'نام کاربری ۳ تا ۲۴ کاراکتر (حرف، عدد، _ . - و فاصله بین کلمات) باشد.', invalid_password: 'رمز عبور باید ۸ تا ۱۲۸ کاراکتر باشد.', weak_password: 'رمز عبور بیش از حد ساده است.', invalid_credentials: 'نام کاربری یا رمز عبور درست نیست.' };
    if (r.status === 429) return 'تلاش‌های زیاد. ' + (r.retry ? r.retry + ' ثانیه' : 'کمی') + ' بعد دوباره امتحان کنید.';
    return m[c] || 'خطای سرور. دوباره تلاش کنید.';
  }
  async function srvEnter(path, name, pw, adoptLegacy) {
    var r; try { r = await call('POST', path, { username: name, password: pw }); } catch (e) { return 'اتصال به سرور برقرار نشد.'; }
    if (r.status !== 200 && r.status !== 201) return srvErr(r);
    setSrv(r.json); me = { id: srv.uid, username: srv.username };
    localStorage.removeItem(verKey()); localStorage.removeItem(syncedKey());
    if (adoptLegacy && localStorage.getItem(LEGACY_KEY)) { localStorage.setItem(stateKey(), localStorage.getItem(LEGACY_KEY)); localStorage.removeItem(LEGACY_KEY); }
    try { var g = await authed('GET', '/api/state'); if (g.status === 200 && g.json.state) { var str = JSON.stringify(g.json.state); localStorage.setItem(stateKey(), str); localStorage.setItem(syncedKey(), str); localStorage.setItem(verKey(), String(g.json.version)); } } catch (e) {}
    localStorage.removeItem(SCRATCH_KEY); return '';
  }

  window.AriaAuth = {
    loggedIn: function () { return !!me; },
    username: function () { return me ? me.username : ''; },
    storeKey: function () { return me ? 'aria_state_v2_' + me.id : SCRATCH_KEY; },
    queueSync: function () { if (!SERVER || !me) return; clearTimeout(timer); timer = setTimeout(pushNow, 20000); },
    logout: async function () {
      if (SERVER && srv) { await pushNow(); try { await call('POST', '/api/auth/logout', { refreshToken: srv.refresh }); } catch (e) {} localStorage.removeItem(SRV_KEY); }
      else localStorage.removeItem(SESSION_KEY);
      window.__ARIA_NOSAVE = true; location.reload();
    },
    deleteAccount: async function (pw) {
      if (!me) return false;
      if (SERVER) {
        var r; try { r = await authed('DELETE', '/api/account', { password: pw }); } catch (e) { return false; }
        if (r.status !== 204) return false;
        [stateKey(), verKey(), syncedKey(), SRV_KEY].forEach(function (k) { localStorage.removeItem(k); });
        window.__ARIA_NOSAVE = true; location.reload(); return true;
      }
      var d = await derive(pw, unb64(me.salt), me.iter);
      if (!safeEq(d, unb64(me.hash))) return false;
      window.__ARIA_NOSAVE = true;
      localStorage.removeItem('aria_state_v2_' + me.id);
      write(USERS_KEY, users().filter(function (u) { return u.id !== me.id; }));
      localStorage.removeItem(SESSION_KEY); location.reload(); return true;
    }
  };
  if (SERVER && me) {
    setTimeout(startupSync, 1500);
    document.addEventListener('visibilitychange', function () { if (document.hidden) pushNow(); });
  }

  async function register(name, pw, pw2) {
    if (SERVER) {
      var c = String(name || '').normalize('NFKC').trim();
      if (!validName(c)) return 'نام کاربری ۳ تا ۲۴ کاراکتر (حرف، عدد، _ . - و فاصله بین کلمات) باشد.';
      var pe0 = validPw(pw, c); if (pe0) return pe0;
      if (pw !== pw2) return 'تکرار رمز عبور یکسان نیست.';
      return srvEnter('/api/auth/register', c, pw, true);
    }
    var clean = String(name || '').normalize('NFKC').trim();
    if (!validName(clean)) return 'نام کاربری ۳ تا ۲۴ کاراکتر (حرف، عدد، _ . - و فاصله بین کلمات) باشد.';
    var pe = validPw(pw, clean); if (pe) return pe;
    if (pw !== pw2) return 'تکرار رمز عبور یکسان نیست.';
    var list = users();
    if (list.some(function (u) { return norm(u.username) === norm(clean); })) return 'این نام کاربری قبلاً گرفته شده است.';
    var salt = crypto.getRandomValues(new Uint8Array(16)), hash = await derive(pw, salt, ITER);
    var rec = { id: hex(8), username: clean, salt: b64(salt), hash: b64(hash), iter: ITER, created: Date.now(), fails: 0, lockUntil: 0 };
    if (list.length === 0 && localStorage.getItem(LEGACY_KEY)) { // first account adopts pre-login progress
      localStorage.setItem('aria_state_v2_' + rec.id, localStorage.getItem(LEGACY_KEY)); localStorage.removeItem(LEGACY_KEY);
    }
    list.push(rec); write(USERS_KEY, list); write(SESSION_KEY, { uid: rec.id, exp: Date.now() + SESSION_MS });
    localStorage.removeItem(SCRATCH_KEY); return '';
  }
  async function login(name, pw) {
    if (SERVER) return srvEnter('/api/auth/login', String(name || ''), String(pw || ''), false);
    var GENERIC = 'نام کاربری یا رمز عبور درست نیست.', list = users();
    var u = list.filter(function (x) { return norm(x.username) === norm(name); })[0];
    if (!u) { await derive(String(pw || ''), new Uint8Array(16), ITER); return GENERIC; } // equalise timing
    if (u.lockUntil > Date.now()) return 'به‌دلیل تلاش‌های ناموفق، ' + Math.ceil((u.lockUntil - Date.now()) / 1000) + ' ثانیه صبر کنید.';
    var ok = safeEq(await derive(String(pw || ''), unb64(u.salt), u.iter), unb64(u.hash));
    if (!ok) {
      u.fails = (u.fails || 0) + 1;
      if (u.fails >= MAX_FAILS) { u.lockUntil = Date.now() + Math.min(900, 30 * Math.pow(2, u.fails - MAX_FAILS)) * 1000; }
      write(USERS_KEY, list); return GENERIC;
    }
    u.fails = 0; u.lockUntil = 0; write(USERS_KEY, list);
    write(SESSION_KEY, { uid: u.id, exp: Date.now() + SESSION_MS }); localStorage.removeItem(SCRATCH_KEY); return '';
  }

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function field(label, type, ac) {
    var w = el('label', 'au-field'); w.appendChild(el('span', null, label));
    var i = el('input'); i.type = type; i.autocomplete = ac; i.maxLength = 128; i.setAttribute('dir', 'ltr'); w.appendChild(i); return { w: w, i: i };
  }
  function buildGate() {
    document.querySelectorAll('.shell,.bottom-nav,.app-footer').forEach(function (n) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); });
    var ov = el('div', 'au-overlay'), card = el('form', 'au-card'); card.noValidate = true; ov.appendChild(card);
    card.appendChild(el('h2', null, 'آریا ادیت'));
    card.appendChild(el('p', 'au-sub', 'برای ادامه وارد شوید یا حساب بسازید. پیشرفت هر حساب جدا ذخیره می‌شود.'));
    var tabs = el('div', 'au-tabs'), tL = el('button', 'au-tab on', 'ورود'), tR = el('button', 'au-tab', 'ساخت حساب');
    tL.type = tR.type = 'button'; tabs.append(tL, tR); card.appendChild(tabs);
    var fu = field('نام کاربری', 'text', 'username'), fp = field('رمز عبور', 'password', 'current-password'), fp2 = field('تکرار رمز عبور', 'password', 'new-password');
    fp2.w.style.display = 'none';
    var show = el('label', 'au-show'), cb = el('input'); cb.type = 'checkbox'; show.append(cb, document.createTextNode(' نمایش رمز'));
    cb.addEventListener('change', function () { fp.i.type = fp2.i.type = cb.checked ? 'text' : 'password'; });
    var msg = el('div', 'au-msg'); msg.setAttribute('role', 'alert');
    var go = el('button', 'au-go', 'ورود'); go.type = 'submit';
    card.append(fu.w, fp.w, fp2.w, show, msg, go);
    var mode = 'login';
    function setMode(m) {
      mode = m; tL.classList.toggle('on', m === 'login'); tR.classList.toggle('on', m === 'register');
      fp2.w.style.display = m === 'register' ? '' : 'none'; go.textContent = m === 'login' ? 'ورود' : 'ساخت حساب';
      fp.i.autocomplete = m === 'login' ? 'current-password' : 'new-password'; msg.textContent = '';
      if (m === 'register' && (SERVER || users().length === 0) && localStorage.getItem(LEGACY_KEY)) msg.textContent = 'پیشرفت قبلی این دستگاه به اولین حساب منتقل می‌شود.';
    }
    tL.onclick = function () { setMode('login'); }; tR.onclick = function () { setMode('register'); };
    card.addEventListener('submit', async function (e) {
      e.preventDefault(); if (!SERVER && !(window.crypto && crypto.subtle)) { msg.textContent = 'این مرورگر از رمزنگاری امن پشتیبانی نمی‌کند (نیاز به HTTPS).'; return; }
      go.disabled = true; msg.textContent = 'در حال بررسی…';
      try {
        var err = mode === 'login' ? await login(fu.i.value, fp.i.value) : await register(fu.i.value, fp.i.value, fp2.i.value);
        if (err) { msg.textContent = err; go.disabled = false; return; }
        location.reload();
      } catch (x) { msg.textContent = 'خطای غیرمنتظره. دوباره تلاش کنید.'; go.disabled = false; }
    });
    document.body.appendChild(ov);
  }
  function buildAccountCard() {
    var v = document.getElementById('view-profile'); if (!v || !me) return;
    var c = el('div', 'card au-account'); c.appendChild(el('div', 'section-title', 'حساب کاربری'));
    c.appendChild(el('p', 'au-sub', 'وارد شده با: ' + me.username));
    var out = el('button', 'ghost-btn', 'خروج از حساب'); out.type = 'button'; out.onclick = function () { window.AriaAuth.logout(); };
    var del = el('button', 'ghost-btn au-danger', 'حذف حساب و تمام پیشرفت'); del.type = 'button';
    var box = el('div', 'au-del'); box.style.display = 'none';
    var pw = el('input'); pw.type = 'password'; pw.placeholder = 'رمز عبور برای تأیید'; pw.autocomplete = 'current-password';
    var ok = el('button', 'ghost-btn au-danger', 'تأیید حذف نهایی'); ok.type = 'button'; var m = el('div', 'au-msg'); box.append(pw, ok, m);
    del.onclick = function () { box.style.display = box.style.display === 'none' ? '' : 'none'; };
    ok.onclick = async function () { ok.disabled = true; var r = await window.AriaAuth.deleteAccount(pw.value); if (!r) { m.textContent = 'رمز عبور درست نیست.'; ok.disabled = false; } };
    var row = el('div', 'au-row'); row.append(out, del); c.append(row, box); v.appendChild(c);
  }
  function init() { if (!me) buildGate(); else buildAccountCard(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
