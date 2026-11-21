/* Dr. Gendy — Email OTP + Auto Student ID (DG-1001...), Admin Dashboard (CMS/Quiz/Students/Scores/Alerts),
 * and protected Canvas/Watermark/Heartbeat player. */
const CFG = {
  API: 'https://lecture-vod.bazabezo-ana.workers.dev',
  CONFIG: '/api/config',
  SIGNUP: '/api/signup',
  RESEND_OTP: '/api/resend-otp',
  VERIFY_OTP: '/api/verify-otp',
  FORGOT: '/api/forgot-password',
  RESET: '/api/reset-password',
  GOOGLE_AUTH: '/api/auth/google',
  LOGIN: '/api/login',
  CATALOG: '/api/catalog',
  PLAY: '/api/play/',
  STREAM_PING: '/api/stream/ping',
  PDF: '/api/pdf/',
  QUIZ_SUBMIT: '/api/quiz-submit',
  ADMIN_OVERVIEW: '/api/admin/overview',
  ADMIN_SETTINGS: '/api/admin/settings',
  ADMIN_STUDENT: '/api/admin/student',
  ADMIN_CATALOG: '/api/admin/catalog',
  ADMIN_DRIVE_VIDEOS: '/api/admin/drive-videos',
  DEMO_DATA: 'data/courses.json'
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls = { get: k => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } };
let session = JSON.parse(sessionStorage.getItem('dg:s') || 'null'), catalog = [], course = null, cleanup = null;
let pendingEmail = '', resetEmail = '', resendTimer = 0;
let adminData = null, adminTab = 'students';
let driveVideos = [];
let googleClientId = '', googleInited = false;

const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400) };
const hideToast = () => { const t = $('#toast'); if (t) { t.classList.remove('show'); t.textContent = ''; } };
const fmt = s => { s = Math.max(0, s | 0); const h = s / 3600 | 0, m = (s % 3600) / 60 | 0; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0') };
const auth = (extra = {}) => ({ headers: { Authorization: 'Bearer ' + (session?.token || ''), ...extra } });

const isSafariNative = () => {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Safari\//.test(ua) && /Version\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|Android)/i.test(ua);
};

/* Stable per-tab client id: binds /api/play, /heartbeat and the /vod/<token>/<exp>/<slug>/<sid>/<cid>/... path. */
const CID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CLIENT_CID = (() => {
  let id = '';
  try { id = sessionStorage.getItem('dg:cid') || ''; } catch {}
  if (!CID_RE.test(id)) {
    const bytes = new Uint8Array(16);
    (globalThis.crypto?.getRandomValues ? globalThis.crypto : { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 256 | 0; return a; } }).getRandomValues(bytes);
    id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem('dg:cid', id); } catch {}
  }
  return id;
})();
const DEVICE_LIMIT_MSG = 'Device limit reached: this account is active on 2 devices. Contact the administration to reset your devices. \u2014 \u0648\u0635\u0644 \u062d\u0633\u0627\u0628\u0643 \u0644\u0644\u062d\u062f \u0627\u0644\u0623\u0642\u0635\u0649 (\u062c\u0647\u0627\u0632\u0627\u0646)\u060c \u062a\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u0644\u0625\u0639\u0627\u062f\u0629 \u0636\u0628\u0637 \u0627\u0644\u0623\u062c\u0647\u0632\u0629.';
const STREAM_CONFLICT_MSG = 'الحساب مشغّل محاضرة حالياً على جهازك الآخر — أوقف التشغيل هناك أولاً';
function getDeviceInfo() {
  let deviceId = '';
  try { deviceId = localStorage.getItem('dg:devid') || ''; } catch {}
  if (!CID_RE.test(deviceId)) {
    const bytes = new Uint8Array(16);
    (globalThis.crypto?.getRandomValues ? globalThis.crypto : { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 256 | 0; return a; } }).getRandomValues(bytes);
    deviceId = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('dg:devid', deviceId); } catch {}
  }
  const scr = `${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 24}`;
  return { deviceId, screen: scr };
}

/* theme */
$('#theme').onclick = () => { const d = document.documentElement, n = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = n; ls.set('dg:theme', n) };

/* auth view switching + resend cooldown */
function showAuthCard(which) {
  $('#loginForm').hidden = which !== 'login';
  $('#signupForm').hidden = which !== 'signup';
  $('#otpForm').hidden = which !== 'otp';
  $('#forgotForm').hidden = which !== 'forgot';
  $('#resetForm').hidden = which !== 'reset';
  $('#loginErr').textContent = $('#signupErr').textContent = $('#otpErr').textContent = $('#forgotErr').textContent = $('#resetErr').textContent = '';
  document.querySelectorAll('.pw-wrap').forEach(w => {
    const inp = w.querySelector('input'), btn = w.querySelector('.pw-eye');
    if (inp) inp.type = 'password';
    if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', 'Show password'); }
  });
  if (which === 'login' || which === 'signup') renderGoogleButtons();
}
function startResendCooldown(sec = 60) {
  clearInterval(resendTimer);
  const btn = $('#resendOtp');
  let rem = sec;
  const tick = () => {
    if (rem <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = 'Resend Code'; }
    else { btn.disabled = true; btn.textContent = `Resend Code (${rem}s)`; rem--; }
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}
$('#toSignup').onclick = () => showAuthCard('signup');
$('#toLogin').onclick = () => showAuthCard('login');
$('#otpBack').onclick = () => { clearInterval(resendTimer); showAuthCard('signup'); };
$('#toForgot').onclick = () => showAuthCard('forgot');
$('#forgotBack').onclick = () => showAuthCard('login');
$('#resetBack').onclick = () => showAuthCard('forgot');

document.querySelectorAll('.pw-eye').forEach(btn => {
  btn.onclick = () => {
    const inp = btn.closest('.pw-wrap')?.querySelector('input');
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    inp.focus({ preventScroll: true });
  };
});

/* Google Sign-In */
function showVisibleAuthErr(msg) {
  if (!$('#signupForm').hidden) $('#signupErr').textContent = msg;
  else $('#loginErr').textContent = msg;
}
async function handleGoogleCredential(resp) {
  if (!resp || !resp.credential) return;
  showVisibleAuthErr('');
  try {
    const res = await fetch(CFG.API + CFG.GOOGLE_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential, ...getDeviceInfo() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403 && data.code === 'DEVICE_LIMIT') {
        hideToast();
        throw new Error(DEVICE_LIMIT_MSG);
      }
      throw new Error(data.error || 'Google sign-in failed.');
    }
    session = {
      token: data.token, id: data.id, name: data.name, email: data.email || '',
      role: data.role || 'student', status: data.status || 'inactive', freeAccess: !!data.freeAccess,
    };
    sessionStorage.setItem('dg:s', JSON.stringify(session));
    toast(`Signed in as ${session.id}`);
    boot();
  } catch (x) {
    showVisibleAuthErr(x.message || 'Could not sign in with Google.');
  }
}
function getGoogleButtonWidth() {
  const candidates = [$('.g-btn-box'), $('#loginForm'), $('#signupForm')];
  for (const el of candidates) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 180) return Math.max(180, Math.floor(r.width));
  }
  return 340;
}
let googleRenderTimer = 0;
function renderGoogleButtons() {
  if (!googleClientId || !window.google?.accounts?.id) return;
  if (!googleInited) {
    window.google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCredential });
    googleInited = true;
  }
  const btnWidth = getGoogleButtonWidth();
  const opts = {
    theme: 'filled_black',
    shape: 'rectangular',
    size: 'large',
    text: 'continue_with',
    locale: 'en',
    width: btnWidth,
  };
  for (const [wrapId, btnId] of [['#gLoginWrap', '#gBtnLogin'], ['#gSignupWrap', '#gBtnSignup']]) {
    const wrap = $(wrapId), btn = $(btnId);
    if (!wrap || !btn) continue;
    wrap.hidden = false;
    btn.innerHTML = '';
    window.google.accounts.id.renderButton(btn, opts);
  }
}
window.addEventListener('resize', () => {
  clearTimeout(googleRenderTimer);
  googleRenderTimer = setTimeout(renderGoogleButtons, 180);
});
async function initGoogleAuth() {
  if (!CFG.API) return;
  try {
    const res = await fetch(CFG.API + CFG.CONFIG);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    googleClientId = String(data.googleClientId || '').trim();
    if (!googleClientId) return;
    let tries = 0;
    const waitGsi = () => {
      if (window.google?.accounts?.id) renderGoogleButtons();
      else if (++tries < 60) setTimeout(waitGsi, 150);
    };
    waitGsi();
  } catch {}
}

/* sign in */
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#loginErr'); err.textContent = ''; hideToast();
  const sid = String(f.get('id') || '').trim();
  const code = String(f.get('code') || '').trim();
  try {
    let r = { token: 'demo', id: sid, name: sid, role: 'student', status: 'active', freeAccess: false };
    if (CFG.API) {
      const res = await fetch(CFG.API + CFG.LOGIN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sid, code, ...getDeviceInfo() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) throw new Error(data.error || 'Wrong Student ID/Email or password.');
        if (res.status === 403 && data.code === 'DEVICE_LIMIT') throw new Error(DEVICE_LIMIT_MSG);
        throw new Error(data.error || 'Server error. Try again.');
      }
      r = data;
    }
    session = { token: r.token, id: r.id || sid, name: r.name || sid, email: r.email || '', role: r.role || 'student', status: r.status || 'active', freeAccess: !!r.freeAccess };
    sessionStorage.setItem('dg:s', JSON.stringify(session));
    if (session.role === 'admin') location.hash = '#/admin';
    boot();
  } catch (x) { hideToast(); err.textContent = x.message || 'Could not sign in. Check your connection.' }
};

/* sign up -> Brevo Email OTP */
$('#signupForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#signupErr'), btn = $('#signupBtn');
  err.textContent = '';
  const name = String(f.get('name') || '').trim();
  const email = String(f.get('email') || '').trim();
  const password = String(f.get('password') || '');
  btn.disabled = true; btn.textContent = 'Sending code...';
  try {
    const res = await fetch(CFG.API + CFG.SIGNUP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign up failed.');
    pendingEmail = data.email;
    $('#otpSub').textContent = `We sent a 6-digit code to ${data.email}. Check your inbox (and Spam folder).`;
    showAuthCard('otp');
    startResendCooldown(60);
  } catch (x) { err.textContent = x.message || 'Could not start verification.'; }
  finally { btn.disabled = false; btn.textContent = 'Send Verification Code'; }
};

/* resend OTP */
$('#resendOtp').onclick = async () => {
  const err = $('#otpErr'); err.textContent = '';
  if (!pendingEmail) return showAuthCard('signup');
  try {
    const res = await fetch(CFG.API + CFG.RESEND_OTP, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: pendingEmail })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429 && data.retryAfter) startResendCooldown(data.retryAfter);
      throw new Error(data.error || 'Could not resend code.');
    }
    toast('New code sent to ' + data.email);
    startResendCooldown(60);
  } catch (x) { err.textContent = x.message || 'Resend failed.' }
};

/* verify OTP -> receives Auto-Generated Student ID (DG-1001...) */
$('#otpForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#otpErr'), btn = $('#verifyBtn');
  err.textContent = '';
  const otp = String(f.get('otp') || '').trim();
  btn.disabled = true; btn.textContent = 'Verifying...';
  try {
    const res = await fetch(CFG.API + CFG.VERIFY_OTP, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: pendingEmail, otp, ...getDeviceInfo() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Invalid or expired OTP.');
    clearInterval(resendTimer);
    session = { token: data.token, id: data.id, name: data.name, email: data.email || pendingEmail, role: 'student', status: data.status || 'inactive', freeAccess: !!data.freeAccess };
    sessionStorage.setItem('dg:s', JSON.stringify(session));
    toast(`Verified! Your Student ID is ${session.id}`);
    boot();
  } catch (x) { err.textContent = x.message || 'Verification failed.'; }
  finally { btn.disabled = false; btn.textContent = 'Verify & Get Student ID'; }
};

/* forgot password -> step 1: request OTP */
$('#forgotForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#forgotErr'), btn = $('#forgotBtn');
  err.textContent = '';
  const email = String(f.get('email') || '').trim();
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    const res = await fetch(CFG.API + CFG.FORGOT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send reset code.');
    resetEmail = email;
    $('#resetSub').textContent = `If ${email} is registered, a 6-digit code was sent. Check Inbox and Spam.`;
    showAuthCard('reset');
  } catch (x) { err.textContent = x.message || 'Request failed.'; }
  finally { btn.disabled = false; btn.textContent = 'Send Reset Code'; }
};

/* forgot password -> step 2: verify OTP & set new password */
$('#resetForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#resetErr'), btn = $('#resetBtn');
  err.textContent = '';
  const code = String(f.get('code') || '').trim();
  const newPassword = String(f.get('newPassword') || '');
  btn.disabled = true; btn.textContent = 'Updating...';
  try {
    const res = await fetch(CFG.API + CFG.RESET, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: resetEmail, code, newPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Reset failed.');
    e.target.reset();
    showAuthCard('login');
    const idInput = $('#loginForm input[name="id"]');
    if (idInput && resetEmail) idInput.value = resetEmail;
    toast('Password updated! You can now sign in.');
  } catch (x) { err.textContent = x.message || 'Could not update password.'; }
  finally { btn.disabled = false; btn.textContent = 'Update Password'; }
};

$('#logout').onclick = () => { sessionStorage.removeItem('dg:s'); session = null; adminData = null; location.hash = '#/'; showAuthCard('login'); boot() };
$('#idPill').onclick = async () => {
  if (!session?.id) return;
  try { await navigator.clipboard.writeText(session.id); toast('Copied Student ID: ' + session.id); }
  catch { toast('Student ID: ' + session.id); }
};
$('#adminBtn').onclick = () => { location.hash = location.hash === '#/admin' ? '#/' : '#/admin'; };

function renderStudentStatusBanner() {
  const b = $('#subBanner');
  if (!session || session.role === 'admin') { b.hidden = true; return; }
  if (session.freeAccess) {
    b.hidden = false;
    b.innerHTML = `<span><strong>Free Access Mode (ليلة الامتحان) is ON:</strong> All published lectures are unlocked for you.</span><span class="id-pill" onclick="document.getElementById('idPill').click()">ID: ${esc(session.id)}</span>`;
    return;
  }
  if (session.status !== 'active') {
    b.hidden = false;
    b.innerHTML = `<span><strong>Account awaiting activation:</strong> Send your Student ID <strong>${esc(session.id)}</strong> to Dr. Gendy to activate playback.</span><button class="btn sm lime" type="button" id="copyIdBan">Copy ID</button>`;
    const cBtn = $('#copyIdBan');
    if (cBtn) cBtn.onclick = () => $('#idPill').click();
    return;
  }
  b.hidden = true;
}

async function boot() {
  $('#login').hidden = !!session; $('#app').hidden = !session;
  if (!session) { renderGoogleButtons(); return; }
  $('#who').textContent = session.name;
  $('#hi').textContent = 'Welcome, ' + session.name;
  $('#adminBtn').hidden = session.role !== 'admin';
  if (session.role !== 'admin' && session.id) {
    $('#idPill').hidden = false;
    $('#idPill').textContent = `ID: ${session.id} [Copy]`;
  } else {
    $('#idPill').hidden = true;
  }

  try {
    const res = await fetch(CFG.API ? CFG.API + CFG.CATALOG : CFG.DEMO_DATA, CFG.API ? auth() : {});
    if (res.status === 401 || res.status === 403) return $('#logout').click();
    const data = await res.json();
    catalog = data.courses || [];
    if (data.status) session.status = data.status;
    if (typeof data.freeAccess === 'boolean') session.freeAccess = data.freeAccess;
    sessionStorage.setItem('dg:s', JSON.stringify(session));
  } catch { catalog = []; toast('Could not load courses') }

  renderStudentStatusBanner();
  const sel = $('#course'); sel.innerHTML = catalog.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
  sel.value = ls.get('dg:course') && catalog.some(c => c.id === ls.get('dg:course')) ? ls.get('dg:course') : catalog[0]?.id;
  route();
}
$('#course').onchange = e => { ls.set('dg:course', e.target.value); location.hash = '#/'; renderList() };
$('#search').oninput = renderList;
addEventListener('hashchange', route);

function route() {
  if (!session) return;
  if (cleanup) { cleanup(); cleanup = null }
  if (location.hash === '#/admin' && session.role === 'admin') {
    $('#home').hidden = true; $('#lecture').hidden = true; $('#adminView').hidden = false;
    $('#adminBtn').textContent = 'Back to Courses';
    loadAdmin();
    return;
  }
  $('#adminView').hidden = true;
  if (session.role === 'admin') $('#adminBtn').textContent = 'Admin Panel';
  const m = location.hash.match(/^#\/l\/([^/]+)\/([^/]+)$/);
  const c = m && catalog.find(x => x.id === decodeURIComponent(m[1])), l = c?.lectures.find(x => x.id === decodeURIComponent(m[2]));
  $('#home').hidden = !!l; $('#lecture').hidden = !l;
  if (l && l.status === 'published') { course = c; openLecture(c, l) } else { renderList(); scrollTo(0, 0) }
}

/* home */
const prog = id => +ls.get('dg:prog:' + id) || 0;
function renderList() {
  course = catalog.find(c => c.id === $('#course').value); const q = $('#search').value.trim().toLowerCase();
  const items = (course?.lectures || []).map((l, i) => ({ l, i })).filter(x => x.l.title.toLowerCase().includes(q));
  $('#list').innerHTML = items.length ? items.map(({ l, i }) => {
    const on = l.status === 'published', p = prog(l.id), has = v => v ? 'on' : 'off';
    return `<li class="lec ${on ? '' : 'off'} ${p > .9 ? 'done' : ''}" ${on ? `tabindex="0" data-id="${esc(l.id)}"` : 'aria-disabled="true"'}>
      <div class="num">${p > .9 ? '✓' : i + 1}</div>
      <div><h3>${esc(l.title)}</h3><div class="sub">${on ? (l.duration ? l.duration + ' min' : '') + (p > .02 && p <= .9 ? ' \u00b7 ' + Math.round(p * 100) + '% watched' : '') : 'Coming soon'}</div></div>
      <div class="chips"><span class="chip ${has(l.hasPdf ?? l.pdf)}">PDF</span><span class="chip ${has(l.quizHtml || l.quiz)}">Quiz</span></div>
      ${on && p > .02 ? `<i class="prog" style="width:${Math.round(p * 100)}%"></i>` : ''}</li>`;
  }).join('') : '<li class="empty">No lectures found.</li>';
}
const go = e => { const li = e.target.closest('.lec[data-id]'); if (li && (e.type === 'click' || e.key === 'Enter')) location.hash = `#/l/${encodeURIComponent(course.id)}/${encodeURIComponent(li.dataset.id)}` };
$('#list').addEventListener('click', go); $('#list').addEventListener('keydown', go);

/* lecture */
async function openLecture(c, l) {
  scrollTo(0, 0);
  const pub = c.lectures.filter(x => x.status === 'published'), k = pub.indexOf(l);
  $('#lTitle').textContent = l.title; $('#lMeta').textContent = c.title + (l.duration ? ' \u00b7 ' + l.duration + ' min' : '');
  const nav = (b, t) => { b.disabled = !t; b.onclick = () => t && (location.hash = `#/l/${encodeURIComponent(c.id)}/${encodeURIComponent(t.id)}`) };
  nav($('#prev'), pub[k - 1]); nav($('#next'), pub[k + 1]);
  renderPdf(l); renderQuiz(l);
  let playData = l.hls ? { url: l.hls, hb: null } : null;
  let playErr = '';
  if (CFG.API) {
    try {
      const dev = getDeviceInfo();
      const reqEngine = (!isSafariNative() && window.Hls && Hls.isSupported()) ? 'hls' : 'native';
      const qs = new URLSearchParams({ cid: CLIENT_CID, engine: reqEngine, deviceId: dev.deviceId, screen: dev.screen });
      const res = await fetch(CFG.API + CFG.PLAY + encodeURIComponent(l.id) + '?' + qs.toString(), auth({ 'X-Client-Id': CLIENT_CID }));
      if (res.status === 401) return $('#logout').click();
      const body = await res.json().catch(() => ({}));
      if (res.ok) playData = body;
      else {
        playData = null;
        playErr = (res.status === 409 && body.code === 'STREAM_ACTIVE') ? STREAM_CONFLICT_MSG : (body.error || 'Video unavailable.');
      }
    } catch { playData = null; playErr = 'Connection error.'; }
  }
  if (location.hash.indexOf(encodeURIComponent(l.id)) < 0) return;
  cleanup = mountPlayer($('#player'), playData, l, pub[k + 1], playErr);
}

async function renderPdf(l) {
  const b = $('#pdfBox'), ok = !!(l.hasPdf ?? l.pdf); b.classList.toggle('off', !ok);
  b.innerHTML = `<div class="phead"><div><h3>Lecture PDF</h3><span class="muted">${ok ? 'Slides and notes for this lecture.' : 'Not uploaded yet.'}</span></div>
  <button class="btn" id="pdfDl" type="button" ${ok ? '' : 'disabled aria-disabled="true"'}>Download PDF</button></div>`;
  if (!ok) return;
  const btn = $('#pdfDl');
  btn.onclick = async () => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing...';
    try {
      const res = await fetch(CFG.API + CFG.PDF + encodeURIComponent(l.id), auth());
      if (res.status === 401) return $('#logout').click();
      if (!res.ok) throw new Error(res.status === 403 ? 'Subscription inactive.' : 'Could not load PDF.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (l.id || 'lecture') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (x) { toast(x.message || 'Download failed.'); }
    finally { btn.disabled = false; btn.textContent = label; }
  };
}

/* quiz (HTML iframe sandbox OR legacy JSON quiz) */
async function renderQuiz(l) {
  const b = $('#quizBox');
  const head = (sub, btn) => `<div class="phead"><div><h3>Quiz</h3><span class="muted">${sub}</span></div>${btn}</div>`;

  if (l.quizHtml) {
    b.classList.remove('off');
    let opened = false;
    const drawHtml = () => {
      if (!opened) {
        b.innerHTML = head('Interactive lecture quiz.', '<button class="btn lime" id="qsHtml">Start Quiz</button>');
        $('#qsHtml').onclick = () => { opened = true; drawHtml(); };
      } else {
        b.innerHTML = head('Interactive lecture quiz.', '<button class="btn ghost sm" id="qsClose">Close Quiz</button>') +
          '<iframe id="quizFrame" sandbox="allow-scripts" style="width:100%;height:560px;border:1px solid var(--line);border-radius:14px;background:#fff;margin-top:14px"></iframe>';
        $('#quizFrame').srcdoc = l.quizHtml;
        $('#qsClose').onclick = () => { opened = false; drawHtml(); };
      }
    };
    drawHtml();
    return;
  }

  let data = l.quiz;
  if (typeof data === 'string') { try { data = await (await fetch(data)).json() } catch { data = null } }
  const qs = data?.questions || []; b.classList.toggle('off', !qs.length);
  if (!qs.length) return b.innerHTML = head('Not available yet.', '<button class="btn" disabled>Start quiz</button>');

  let i, ans;
  const start = () => { i = 0; ans = new Array(qs.length).fill(null); draw(); };
  b.innerHTML = head(qs.length + ' questions. Submit at the end to see your score and explanations.', '<button class="btn lime" id="qs">Start quiz</button>');
  $('#qs').onclick = start;

  function draw() {
    if (i >= qs.length) return submitQuiz();
    const q = qs[i], isLast = i === qs.length - 1;
    b.innerHTML = `<div class="phead"><h3>Question ${i + 1} of ${qs.length}</h3><span class="muted">${ans.filter(x => x !== null).length} / ${qs.length} answered</span></div>
    <div class="qbar"><i style="width:${((i + 1) / qs.length) * 100}%"></i></div><p class="q">${esc(q.q)}</p>
    <div class="opts">${q.options.map((o, j) => `<button class="opt ${ans[i] === j ? 'sel' : ''}" data-j="${j}">${esc(o)}</button>`).join('')}</div>
    <div class="qnav"><button class="btn ghost sm" id="qb" ${i ? '' : 'disabled'}>Back</button><span class="grow"></span>
    <button class="btn ${isLast ? 'lime' : ''} sm" id="qn" ${ans[i] == null ? 'disabled' : ''}>${isLast ? 'Submit Quiz' : 'Next'}</button></div>`;
    b.querySelectorAll('.opt').forEach(o => o.onclick = () => { ans[i] = +o.dataset.j; draw(); });
    $('#qb').onclick = () => { i--; draw(); };
    $('#qn').onclick = () => { i++; draw(); };
  }

  async function submitQuiz() {
    b.innerHTML = '<h3>Grading your quiz...</h3><p class="muted">Please wait.</p>';
    let resData = null;
    if (CFG.API) {
      try {
        const res = await fetch(CFG.API + CFG.QUIZ_SUBMIT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session?.token || '') },
          body: JSON.stringify({ lectureId: l.id, answers: ans }),
        });
        if (res.status === 401) return $('#logout').click();
        if (res.ok) resData = await res.json();
      } catch {}
    } else {
      // Demo mode fallback
      let score = 0;
      const results = qs.map((q, j) => {
        const ok = Number(ans[j]) === Number(q.answer);
        if (ok) score++;
        return { questionIndex: j, isCorrect: ok, correctAnswer: Number(q.answer), explanation: q.explain || '' };
      });
      resData = { score, total: qs.length, pct: Math.round((score / qs.length) * 100), results };
    }

    if (!resData || !Array.isArray(resData.results)) {
      b.innerHTML = '<h3>Could not submit quiz</h3><p class="err">Connection error. Please try submitting again.</p><div class="qnav"><button class="btn sm" id="retrySub">Retry Submit</button></div>';
      $('#retrySub').onclick = submitQuiz;
      return;
    }

    const byIdx = new Map(resData.results.map(r => [r.questionIndex, r]));
    b.innerHTML = `<h3>Your result</h3><div class="score">${resData.score}/${resData.total}</div><p class="muted">${resData.pct}%</p>
    <div class="rev">${qs.map((q, j) => {
      const r = byIdx.get(j) || {};
      const ok = !!r.isCorrect;
      const corrTxt = q.options[r.correctAnswer] ?? '';
      return `<div><b class="${ok ? 'r' : 'w'}" style="color:var(--${ok ? 'ok' : 'bad'})">${ok ? 'Correct' : 'Incorrect'}</b> \u00b7 ${esc(q.q)}<br>
      <span class="muted">Your answer: ${esc(q.options[ans[j]] ?? 'none')}${ok ? '' : ' \u00b7 Correct: ' + esc(corrTxt)}</span>
      ${r.explanation ? `<br><span class="muted">${esc(r.explanation)}</span>` : ''}</div>`;
    }).join('')}</div>
    <div class="qnav"><span class="grow"></span><button class="btn sm" id="qa">Try again</button></div>`;
    $('#qa').onclick = start;
  }
}

/* ==================== ADMIN DASHBOARD ==================== */
function downloadCsv(filename, rows) {
  const safe = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = rows.map(r => r.map(safe).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; a.click();
}

async function loadAdmin() {
  const v = $('#adminView');
  v.innerHTML = '<p class="muted">Loading Admin Dashboard...</p>';
  try {
    const res = await fetch(CFG.API + CFG.ADMIN_OVERVIEW, auth());
    if (res.status === 401 || res.status === 403) { toast('Admin session expired'); return $('#logout').click(); }
    adminData = await res.json();
    renderAdmin();
  } catch { v.innerHTML = '<p class="err">Failed to load admin overview.</p>'; }
}

function renderAdmin() {
  const v = $('#adminView');
  if (!adminData) return;
  if (adminTab !== 'students' && adminTab !== 'cms') adminTab = 'students';
  const students = adminData.students || [];
  const courses = adminData.courses || [];
  const activeCount = students.filter(s => s.status === 'active').length;
  const bannedCount = students.filter(s => s.status === 'banned').length;
  const pubCount = courses.reduce((n, c) => n + (c.lectures || []).filter(l => l.status === 'published').length, 0);

  v.innerHTML = `
    <div class="adm-top">
      <div><h2>Dr. Gendy — Admin Panel</h2><p class="muted">Students, subscriptions &amp; courses management</p></div>
      <div class="adm-acts">
        <button id="toggleFree" class="btn ${adminData.freeAccess ? 'lime' : 'ghost'}">${adminData.freeAccess ? '🟢 وضع ليلة الامتحان: مفعّل (Free Access ON)' : '⚪ وضع ليلة الامتحان: مغلق (Paid Only)'}</button>
        <button id="admRefresh" class="btn ghost sm">Refresh</button>
      </div>
    </div>
    <div class="adm-kpis">
      <div class="kpi"><span class="muted">Students</span><b>${students.length}</b></div>
      <div class="kpi"><span class="muted">Active Subs</span><b>${activeCount}</b></div>
      <div class="kpi"><span class="muted">Banned</span><b>${bannedCount}</b></div>
      <div class="kpi"><span class="muted">Published Lecs</span><b>${pubCount}</b></div>
    </div>
    <div class="adm-tabs">
      <button class="btn ghost sm ${adminTab === 'students' ? 'active' : ''}" data-tab="students">Students (${students.length})</button>
      <button class="btn ghost sm ${adminTab === 'cms' ? 'active' : ''}" data-tab="cms">Courses &amp; Quizzes</button>
    </div>
    <div id="admBody"></div>`;

  v.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { adminTab = b.dataset.tab; renderAdmin(); });
  $('#admRefresh').onclick = loadAdmin;
  $('#toggleFree').onclick = async () => {
    const next = !adminData.freeAccess;
    const r = await fetch(CFG.API + CFG.ADMIN_SETTINGS, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, body: JSON.stringify({ freeAccess: next }) });
    if (r.ok) { adminData.freeAccess = next; toast(next ? 'Free Access Mode ON' : 'Free Access Mode OFF'); renderAdmin(); }
  };

  if (adminTab === 'students') renderAdminStudents();
  else renderAdminCms();
}

function renderAdminStudents() {
  const b = $('#admBody'), students = adminData.students || [];
  b.innerHTML = `
    <div class="adm-bar">
      <input id="stuQ" type="search" placeholder="Search ID, name or email..." style="flex:1;min-width:200px">
      <select id="stuF"><option value="all">All Statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="banned">Banned</option></select>
      <button id="expStu" class="btn ghost sm">Export CSV</button>
    </div>
    <div class="tbl-wrap"><table class="adm-tbl"><thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead><tbody id="stuRows"></tbody></table></div>`;

  const draw = () => {
    const q = $('#stuQ').value.trim().toLowerCase(), flt = $('#stuF').value;
    const rows = students.filter(s => (flt === 'all' || s.status === flt) && (!q || s.sid.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)));
    $('#stuRows').innerHTML = rows.length ? rows.map(s => `<tr>
      <td><strong>${esc(s.sid)}</strong></td><td>${esc(s.name)}</td><td>${esc(s.email)}</td>
      <td>${s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '-'}</td>
      <td><span class="tag-st st-${esc(s.status)}">${esc(s.status)}</span></td>
      <td><div class="adm-acts">
        ${s.status !== 'active' ? `<button class="btn lime sm" data-act="active" data-sid="${esc(s.sid)}">Activate</button>` : `<button class="btn ghost sm" data-act="inactive" data-sid="${esc(s.sid)}">Deactivate</button>`}
        ${s.status !== 'banned' ? `<button class="btn ghost sm" data-act="banned" data-sid="${esc(s.sid)}" style="color:#f87171">Ban</button>` : `<button class="btn ghost sm" data-act="inactive" data-sid="${esc(s.sid)}">Unban</button>`}
        <button class="btn ghost sm" data-reset="${esc(s.sid)}" title="Clear this student's registered devices so they can sign in on a new device">Reset Devices</button>
        <button class="btn ghost sm" data-kick="${esc(s.sid)}" title="Force stop active video">Kick</button>
      </div></td></tr>`).join('') : '<tr><td colspan="6" class="muted">No students match.</td></tr>';

    $('#stuRows').querySelectorAll('[data-act]').forEach(btn => btn.onclick = () => updateStudent(btn.dataset.sid, { status: btn.dataset.act }));
    $('#stuRows').querySelectorAll('[data-kick]').forEach(btn => btn.onclick = () => updateStudent(btn.dataset.kick, { kick: true }));
    $('#stuRows').querySelectorAll('[data-reset]').forEach(btn => btn.onclick = () => resetStudentDevices(btn.dataset.reset));
  };
  $('#stuQ').oninput = draw; $('#stuF').onchange = draw;
  $('#expStu').onclick = () => downloadCsv('students.csv', [['Student ID', 'Name', 'Email', 'Status', 'Created'], ...students.map(s => [s.sid, s.name, s.email, s.status, new Date(s.createdAt || 0).toISOString()])]);
  draw();
}

async function updateStudent(sid, payload) {
  const res = await fetch(CFG.API + CFG.ADMIN_STUDENT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
    body: JSON.stringify({ sid, ...payload }),
  });
  if (!res.ok) return toast('Action failed');
  if (payload.status) {
    const s = (adminData.students || []).find(x => x.sid === sid);
    if (s) s.status = payload.status;
    toast(`${sid} -> ${payload.status}`);
  } else if (payload.kick) {
    toast(`Kicked active session for ${sid}`);
  }
  renderAdmin();
}

async function resetStudentDevices(sid) {
  try {
    const res = await fetch(CFG.API + CFG.ADMIN_STUDENT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
      body: JSON.stringify({ sid, resetDevices: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast(data.error || 'Could not reset devices');
    const raw = data.cleared ?? data.devicesCleared ?? data.removed ?? data.count ?? data.devices;
    const n = Array.isArray(raw) ? raw.length : Number(raw);
    toast(Number.isFinite(n)
      ? `Devices reset for ${sid}: ${n} device${n === 1 ? '' : 's'} cleared`
      : `Devices reset for ${sid}`);
    loadAdmin();
  } catch { toast('Could not reset devices'); }
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'lecture';
}

let driveFetchStarted = false;
function renderAdminCms() {
  const b = $('#admBody'), courses = adminData.courses || [];
  if (!driveVideos.length && !driveFetchStarted && CFG.ADMIN_DRIVE_VIDEOS) {
    driveFetchStarted = true;
    fetch(CFG.API + CFG.ADMIN_DRIVE_VIDEOS, auth())
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && Array.isArray(d.videos)) { driveVideos = d.videos; if (adminTab === 'cms') renderAdminCms(); } })
      .catch(() => {});
  }

  const slugifyId = (t, fallback) => {
    const s = String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    return s || fallback;
  };
  const parseDriveId = (raw) => {
    const s = String(raw || '').trim();
    const m = s.match(/\/d\/([A-Za-z0-9_-]{10,80})|[?&]id=([A-Za-z0-9_-]{10,80})/);
    if (m) return m[1] || m[2];
    return /^[A-Za-z0-9_-]{20,80}$/.test(s) ? s : '';
  };

  let html = `<div class="adm-bar"><button id="addCourse" class="btn ghost sm">+ Add Course</button><button id="syncDrive" class="btn ghost sm">Sync from Drive</button><span class="grow"></span><button id="saveCms" class="btn lime">Save All Courses &amp; Quizzes</button></div><div class="cms-grid">`;

  courses.forEach((c, ci) => {
    html += `<div class="cms-card">
      <div class="cms-row">
        <div class="cms-field"><label>Course ID</label><input data-c="${ci}" data-f="id" value="${esc(c.id)}" placeholder="e.g. anatomy"></div>
        <div class="cms-field"><label>Course Title</label><input data-c="${ci}" data-f="title" value="${esc(c.title)}" placeholder="Course Title"></div>
        <div class="adm-acts" style="align-self:end"><button class="btn ghost sm" data-add-lec="${ci}">+ Add Lecture</button><button class="btn ghost sm" data-del-c="${ci}" style="color:#f87171">Delete Course</button></div>
      </div>`;

    (c.lectures || []).forEach((l, li) => {
      const hasDriveMatch = l.driveId && driveVideos.some(v => v.fileId === l.driveId);
      const isCustom = l._forceCustom || (!hasDriveMatch && !!(l.driveId || (l.slug && l.slug !== l.id)));
      const srcVal = l.driveId ? `https://drive.google.com/file/d/${l.driveId}/view` : (l.slug || '');
      let optsHtml = '<option value="">-- Select Drive Video --</option>';
      driveVideos.forEach(v => {
        const mins = v.durationMs ? ` (${Math.max(1, Math.round(v.durationMs / 60000))} min)` : '';
        optsHtml += `<option value="${esc(v.fileId)}" ${l.driveId === v.fileId && !l._forceCustom ? 'selected' : ''}>${esc(v.name + mins)}</option>`;
      });
      if (l.driveId && !hasDriveMatch && !l._forceCustom) {
        optsHtml += `<option value="${esc(l.driveId)}" selected>Drive ID: ${esc(l.driveId)}</option>`;
      }
      optsHtml += `<option value="__custom__" ${isCustom ? 'selected' : ''}>-- Custom Link / ID / B2 Slug --</option>`;

      html += `<div class="cms-lec-card">
        <div class="cms-row-1">
          <div class="cms-field">
            <label>LECTURE TITLE</label>
            <input data-l="${ci}:${li}" data-f="title" value="${esc(l.title)}" placeholder="Lecture Title">
          </div>
          <div class="cms-field">
            <label>STATUS</label>
            <select data-l="${ci}:${li}" data-f="status">
              <option value="published" ${l.status === 'published' ? 'selected' : ''}>Published</option>
              <option value="soon" ${l.status !== 'published' ? 'selected' : ''}>Coming Soon</option>
            </select>
          </div>
        </div>
        <div class="cms-row-2">
          <div class="cms-field">
            <label>DRIVE VIDEO</label>
            <select data-l="${ci}:${li}" data-f="driveSelect">${optsHtml}</select>
            ${isCustom ? `<input data-l="${ci}:${li}" data-f="source" value="${esc(srcVal)}" placeholder="Google Drive link/ID or B2 slug" style="margin-top:6px">` : ''}
          </div>
          <div class="cms-field">
            <label>PDF LINK (OPTIONAL)</label>
            <input data-l="${ci}:${li}" data-f="pdf" value="${esc(l.pdf || '')}" placeholder="PDF URL or key (optional)">
          </div>
        </div>
        <div class="cms-row-3">
          <div class="cms-field">
            <label>QUIZ FILE (.HTML)</label>
            <div class="cms-quiz-wrap">
              <input type="file" accept=".html,.htm" data-qfile="${ci}:${li}">
              ${l.quizHtml ? `<span class="cms-quiz-ok">✅ Quiz HTML attached</span><button type="button" class="btn ghost sm" data-qclear="${ci}:${li}">Clear</button>` : '<span class="muted" style="font-size:12px">No quiz attached</span>'}
            </div>
          </div>
          <button type="button" class="btn ghost sm" data-del-l="${ci}:${li}" style="color:#f87171">Remove Lecture</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  b.innerHTML = html;

  b.querySelectorAll('input[data-c]').forEach(inp => inp.oninput = () => { courses[inp.dataset.c][inp.dataset.f] = inp.value; });
  b.querySelectorAll('input[data-l], select[data-l]').forEach(inp => {
    const [ci, li] = inp.dataset.l.split(':').map(Number);
    const ev = inp.tagName === 'SELECT' ? 'onchange' : 'oninput';
    inp[ev] = () => {
      const f = inp.dataset.f, lec = courses[ci].lectures[li];
      if (f === 'title') {
        lec.title = inp.value;
        if (lec._isNew) lec.id = slugifyId(inp.value, lec.id);
      } else if (f === 'driveSelect') {
        if (inp.value === '__custom__') {
          lec._forceCustom = true;
          renderAdminCms();
        } else {
          lec._forceCustom = false;
          lec.driveId = inp.value || null;
          lec.slug = lec.id;
          const match = driveVideos.find(v => v.fileId === inp.value);
          if (match && match.durationMs) lec.duration = Math.max(1, Math.round(match.durationMs / 60000));
          renderAdminCms();
        }
      } else if (f === 'source') {
        const did = parseDriveId(inp.value);
        lec.driveId = did || null;
        lec.slug = did ? lec.id : inp.value.trim();
      } else if (f === 'pdf') {
        lec.pdf = inp.value.trim() || null;
      } else {
        lec[f] = inp.value;
      }
    };
  });

  b.querySelectorAll('input[data-qfile]').forEach(inp => {
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      if (file.size > 150 * 1024) { toast('Quiz HTML file is too large (max 150 KB)'); inp.value = ''; return; }
      const [ci, li] = inp.dataset.qfile.split(':').map(Number);
      const reader = new FileReader();
      reader.onload = () => {
        courses[ci].lectures[li].quizHtml = String(reader.result || '');
        courses[ci].lectures[li].quiz = null;
        toast('Quiz HTML attached');
        renderAdminCms();
      };
      reader.readAsText(file, 'utf-8');
    };
  });

  b.querySelectorAll('[data-qclear]').forEach(btn => {
    btn.onclick = () => {
      const [ci, li] = btn.dataset.qclear.split(':').map(Number);
      courses[ci].lectures[li].quizHtml = null;
      courses[ci].lectures[li].quiz = null;
      renderAdminCms();
    };
  });

  $('#addCourse').onclick = () => { courses.push({ id: 'course-' + (courses.length + 1), title: 'New Course', lectures: [] }); renderAdminCms(); };
  b.querySelectorAll('[data-del-c]').forEach(btn => btn.onclick = () => { courses.splice(Number(btn.dataset.delC), 1); renderAdminCms(); });
  b.querySelectorAll('[data-add-lec]').forEach(btn => btn.onclick = () => {
    const c = courses[Number(btn.dataset.addLec)];
    const n = c.lectures.length + 1;
    c.lectures.push({ id: `${c.id}-${Date.now().toString(36)}`, slug: '', driveId: null, title: `Lecture ${n}`, duration: null, status: 'soon', pdf: null, quiz: null, quizHtml: null, _isNew: true });
    renderAdminCms();
  });
  b.querySelectorAll('[data-del-l]').forEach(btn => btn.onclick = () => {
    const [ci, li] = btn.dataset.delL.split(':').map(Number);
    courses[ci].lectures.splice(li, 1); renderAdminCms();
  });

  $('#syncDrive').onclick = async () => {
    const btn = $('#syncDrive'); btn.disabled = true; btn.textContent = 'Syncing...';
    try {
      const r = await fetch(CFG.API + CFG.ADMIN_DRIVE_VIDEOS, auth());
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Sync failed');
      driveVideos = d.videos || [];
      if (!courses.length) courses.push({ id: 'course-1', title: 'Main Course', lectures: [] });
      const existing = new Set();
      courses.forEach(c => (c.lectures || []).forEach(l => { if (l.driveId) existing.add(l.driveId); }));
      let added = 0;
      const targetCourse = courses[0];
      driveVideos.forEach(v => {
        if (existing.has(v.fileId)) return;
        const cleanTitle = v.name.replace(/\.[^/.]+$/, '');
        const baseId = slugifyId(cleanTitle, 'lec') + '-' + v.fileId.slice(0, 4).toLowerCase();
        targetCourse.lectures.push({
          id: baseId, slug: baseId, driveId: v.fileId, title: cleanTitle,
          duration: v.durationMs ? Math.max(1, Math.round(v.durationMs / 60000)) : null,
          status: 'soon', pdf: null, quiz: null, quizHtml: null, _isNew: true,
        });
        added++;
      });
      toast(`Synced ${driveVideos.length} videos (${added} new). Click Save!`);
      renderAdminCms();
    } catch (x) {
      toast(x.message || 'Drive sync failed');
    } finally {
      btn.disabled = false; btn.textContent = 'Sync from Drive';
    }
  };

  $('#saveCms').onclick = saveCmsToServer;
}

async function saveCmsToServer() {
  const res = await fetch(CFG.API + CFG.ADMIN_CATALOG, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
    body: JSON.stringify({ courses: adminData.courses }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return toast(data.error || 'Failed to save catalog');
  adminData.courses = data.courses;
  catalog = data.courses;
  toast('Courses & quizzes saved!');
  renderAdmin();
}

const IC = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
  pause: '<rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/>',
  back: '<path d="M12 5V2L7.5 6 12 10V7a6 6 0 1 1-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="16.5" font-size="7" font-weight="700" text-anchor="middle" font-family="sans-serif">10</text>',
  fwd: '<path transform="translate(24 0) scale(-1 1)" d="M12 5V2L7.5 6 12 10V7a6 6 0 1 1-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="16.5" font-size="7" font-weight="700" text-anchor="middle" font-family="sans-serif">10</text>',
  vol: '<path d="M4 9.5v5h3.5l4.5 3.8V5.7L7.5 9.5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5v5h3.5l4.5 3.8V5.7L7.5 9.5z"/><path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
};
const svg = (n, c = '', s = 22) => `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor" aria-hidden="true">${IC[n]}</svg>`;


/* natives captured once, at script load (before any DevTools tampering at runtime) */
const _CP = CanvasRenderingContext2D.prototype;
const NATIVE = {
  fillText: _CP.fillText, fillRect: _CP.fillRect, clearRect: _CP.clearRect,
  getImageData: _CP.getImageData, measureText: _CP.measureText,
  getContext: HTMLCanvasElement.prototype.getContext
};
const _fnToStr = Function.prototype.toString;
const isNativeFn = f => typeof f === 'function' && /\[native code\]/.test(_fnToStr.call(f));
const VV_THRESHOLD = 0.15; // cumulative visualViewport change (15%) that is only logged (no blackout)

/* Playback engine: isolates hls.js vs native so the guard layer above stays untouched.
 * /api/play contract: { url, hb, engine, drm, cid }. `drm` is carried through for future EME support. */
function createEngine(playData, video, onLevels) {
  const url = typeof playData === 'string' ? playData : playData?.url;
  const requested = String((typeof playData === 'object' && playData?.engine) || 'auto').toLowerCase();
  const drm = (typeof playData === 'object' && playData?.drm) || null;
  const useHls = ['auto', 'hlsjs', 'hls', 'mse'].includes(requested) && !!(window.Hls && Hls.isSupported());
  const engine = {
    url, requested, drm, kind: useHls ? 'hlsjs' : 'native', hls: null,
    cid: (typeof playData === 'object' && playData?.cid) || CLIENT_CID,
    token: null,
    rotate(t) { if (t && t.t) { this.token = t; if (t.cid) this.cid = t.cid; } },
    destroy() { if (this.hls) { this.hls.destroy(); this.hls = null; } }
  };
  if (useHls) {
    const inst = new Hls({
      maxBufferLength: 40,
      xhrSetup(xhr, reqUrl) {
        const t = engine.token;
        if (t) {
          // keep /vod/<token>/<exp>/<slug>/<sid>/<cid>/... shape while rotating the token
          reqUrl = reqUrl.replace(/\/vod\/[^/]+\/\d+\/([^/]+)\/([^/]+)\/[^/]+\//,
            `/vod/${t.t}/${t.exp}/$1/$2/${engine.cid || t.cid || CLIENT_CID}/`);
        }
        xhr.open('GET', reqUrl, true);
      }
    });
    engine.hls = inst;
    inst.loadSource(url);
    inst.attachMedia(video);
    inst.on(Hls.Events.MANIFEST_PARSED, () => { if (onLevels) onLevels(inst); });
    inst.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { d.type === Hls.ErrorTypes.NETWORK_ERROR ? inst.startLoad() : inst.recoverMediaError() } });
  } else {
    video.src = url;
  }
  return engine;
}

function mountPlayer(box, playData, l, nextLec, errMessage = '') {
  box.className = 'player';
  const BASE_CSS = 'position:relative;background:#000;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none';
  box.style.cssText = BASE_CSS;
  const url = typeof playData === 'string' ? playData : playData?.url;
  const HB = typeof playData === 'string' ? null : playData?.hb;
  if (!url) {
    box.innerHTML = `<div class="empty" style="margin:20px">${esc(errMessage || 'This video could not be loaded. Refresh or sign in again.')}</div>`;
    return;
  }

  box.innerHTML = `
  <video playsinline webkit-playsinline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback style="display:block;width:100%;height:auto;aspect-ratio:16/9;background:#000;object-fit:contain;cursor:pointer"></video>
  <canvas id="wm" style="position:absolute!important;inset:0!important;width:100%!important;height:100%!important;pointer-events:none!important;z-index:5!important;display:block!important;visibility:visible!important;opacity:1!important"></canvas>
  <div id="blk" style="position:absolute;inset:0;background:#000;color:#fff;display:none;align-items:center;justify-content:center;text-align:center;padding:24px;z-index:20;font:600 15px/1.5 system-ui,sans-serif;cursor:pointer;touch-action:manipulation"></div>
  <button class="big" aria-label="Play or pause" style="z-index:10"><span class="bp">${svg('play', '', 34)}</span></button>
  <div class="ctl" style="z-index:10"><input id="seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
  <div class="row"><button class="cb" id="pp" aria-label="Play">${svg('play', 'i-play')}${svg('pause', 'i-pause')}</button>
  <button class="cb" id="bk" aria-label="Back 10 seconds">${svg('back')}</button><button class="cb" id="fw" aria-label="Forward 10 seconds">${svg('fwd')}</button>
  <span class="volwrap"><button class="cb" id="mu" aria-label="Mute">${svg('vol', 'i-vol')}${svg('mute', 'i-mute')}</button><input class="vol" id="vol" type="range" min="0" max="1" step=".02" value="1" aria-label="Volume"></span>
  <span class="time" id="tm">0:00 / 0:00</span><span class="grow"></span>
  <span class="pwrap"><button class="cb pill" id="sp">1x</button></span><span class="pwrap" id="qw" hidden><button class="cb pill" id="ql">Auto</button></span><button class="cb" id="fs" aria-label="Fullscreen">${svg('full')}</button></div></div>`;

  const v = box.querySelector('video'), canvas = box.querySelector('#wm'), blk = box.querySelector('#blk');
  const $$ = s => box.querySelector(s), key = 'dg:pos:' + l.id;
  v.disableRemotePlayback = true;
  const ctx = NATIVE.getContext.call(canvas, '2d', { willReadFrequently: true });

  const CID = (typeof playData === 'object' && playData?.cid) || CLIENT_CID;
  const nonce = crypto.getRandomValues(new Uint8Array(3));
  const CANARY = [8 + (nonce[0] & 15), 8 + (nonce[1] & 15), 8 + (nonce[2] & 15)];

  let halted = false, isBlackout = false, wasMuted = false;
  let last = 0, idle = 0, bad = 0, isPseudoFs = false, graceUntil = 0, lastDevRep = 0;
  let envStrikes = 0, lastEnvStrike = 0, shotTimer = 0, beatTimer = 0, beatFails = 0;
  const guardLog = (why) => { try { console.debug('[guard]', why); } catch {} };
  let wmLabel = `${session.name} \u00b7 ${session.id}`;
  let wmX = Math.random(), wmY = Math.random(), wmBox = null;

  box.addEventListener('contextmenu', e => e.preventDefault());
  box.addEventListener('dragstart', e => e.preventDefault());

  /* ---------- Playback engine: /api/play returns engine ("hlsjs" | "native") and optional drm ---------- */
  const engine = createEngine(playData, v, hl => {
    const hs = [...new Set(hl.levels.map(x => x.height))].filter(Boolean).sort((a, b) => b - a);
    if (hs.length > 1) {
      $$('#qw').hidden = false;
      $$('#ql').onclick = () => menu($$('#qw'), ['Auto', ...hs.map(h => h + 'p')], $$('#ql').textContent, x => {
        $$('#ql').textContent = x;
        hl.currentLevel = x === 'Auto' ? -1 : hl.levels.findIndex(y => y.height === parseInt(x));
      });
    }
  });
  const hls = engine.hls;

  /* ---------- Transparent overlay: watermark + canary (drawn only on demand) ---------- */
  function sizeCanvas() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function drawWm() {
    if (halted) return;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    NATIVE.clearRect.call(ctx, 0, 0, w, h);
    // displayed video rect (object-fit: contain) so the mark never lands on letterbox bars
    let vx = 0, vy = 0, vw = w, vh = h;
    if (v.videoWidth && v.videoHeight) {
      const s = Math.min(w / v.videoWidth, h / v.videoHeight);
      vw = v.videoWidth * s; vh = v.videoHeight * s; vx = (w - vw) / 2; vy = (h - vh) / 2;
    }
    const fs = Math.max(14, Math.round(vh / 26));
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.textBaseline = 'top';
    const tw = NATIVE.measureText.call(ctx, wmLabel).width;
    const x = vx + wmX * Math.max(0, vw - tw), y = vy + wmY * Math.max(0, vh - fs * 1.4);
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = Math.round(fs / 5);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    NATIVE.fillText.call(ctx, wmLabel, x, y);
    // faint secondary mark on the opposite side (harder to crop out)
    ctx.fillStyle = 'rgba(255,255,255,.26)';
    NATIVE.fillText.call(ctx, wmLabel, vx + (1 - wmX) * Math.max(0, vw - tw), vy + (1 - wmY) * Math.max(0, vh - fs * 1.4));
    ctx.shadowBlur = 0;
    // canary pixel (device pixel 0,0, opaque)
    ctx.fillStyle = `rgb(${CANARY[0]},${CANARY[1]},${CANARY[2]})`;
    NATIVE.fillRect.call(ctx, 0, 0, 1, 1);
    const bx = Math.max(0, Math.floor(x) - 2), by = Math.max(0, Math.floor(y) - 2);
    wmBox = { x: bx, y: by, w: Math.max(1, Math.min(w - bx, Math.ceil(tw) + 4)), h: Math.max(1, Math.min(h - by, Math.ceil(fs * 1.4) + 4)) };
  }
  function wmPresent() {
    if (!wmBox) return true;
    const d = NATIVE.getImageData.call(ctx, wmBox.x, wmBox.y, wmBox.w, wmBox.h).data;
    for (let i = 3; i < d.length; i += 8) if (d[i] > 20) return true;
    return false;
  }
  const moveWm = () => { wmX = Math.random(); wmY = Math.random(); drawWm(); };
  const wt = setInterval(moveWm, 4000);
  const ro = new ResizeObserver(() => { sizeCanvas(); drawWm(); });
  ro.observe(canvas);
  sizeCanvas(); drawWm();
  v.addEventListener('loadedmetadata', drawWm);

  /* ---------- Blackout shield ---------- */
  function setBlackout(on, reason) {
    if (halted) return;
    if (on) {
      if (!isBlackout) wasMuted = v.muted;
      isBlackout = true;           // set first so volume UI sync ignores the forced mute
      v.pause(); v.muted = true;
      blk.textContent = reason || 'Playback paused (window inactive). Click to resume.';
      blk.style.display = 'flex';
    } else if (isBlackout) {
      isBlackout = false;
      v.muted = wasMuted;
      blk.style.display = 'none';
      drawWm();
    }
  }
  function halt(why) {
    if (halted) return;
    halted = true; isBlackout = true;
    v.pause(); v.muted = true; hls && hls.stopLoad();
    NATIVE.clearRect.call(ctx, 0, 0, canvas.width, canvas.height);
    blk.textContent = 'Playback stopped: ' + why;
    blk.style.display = 'flex';
    report('halt:' + why);
  }

  blk.onclick = () => {
    if (halted || document.visibilityState !== 'visible') return;
    setBlackout(false); v.play().catch(() => {});
  };
  const onVis = () => { if (document.visibilityState === 'hidden') setBlackout(true, 'Playback paused while tab is hidden. Click to resume.'); };
  const onBlur = () => guardLog('window-blur');            // informational only (Brave/Firefox false positives)
  const onHide = () => setBlackout(true, 'Playback paused (page inactive). Click to resume.');
  const onFocus = () => { if (!halted && !document.hidden && isBlackout) blk.textContent = 'Playback paused for protection. Click to resume.'; };
  const onKeyGuard = e => {
    const k = (e.key || '').toLowerCase();
    const isDev = k === 'f12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k)) ||
                  (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k)) || (e.ctrlKey && k === 'u');
    const isShot = e.key === 'PrintScreen' || e.code === 'PrintScreen' ||
                   (e.metaKey && e.shiftKey && ['Digit3', 'Digit4', 'Digit5'].includes(e.code)) ||
                   (e.metaKey && e.shiftKey && k === 's');
    if (isShot) {
      e.preventDefault();
      setBlackout(true, 'Screen capture is disabled. Resuming automatically...');
      toast('Screen capture is disabled');
      report('halt:printscreen');
      clearTimeout(shotTimer);
      shotTimer = setTimeout(() => {
        if (!halted && !document.hidden && document.visibilityState === 'visible') { setBlackout(false); v.play().catch(() => {}); }
      }, 3000);
    } else if (isDev) {
      e.preventDefault(); setBlackout(true, 'Developer tools are disabled during playback. Click to resume.'); report('devtools?');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  addEventListener('blur', onBlur);
  addEventListener('focus', onFocus);
  addEventListener('pagehide', onHide);
  document.addEventListener('freeze', onHide);
  addEventListener('keydown', onKeyGuard, true);
  addEventListener('keyup', onKeyGuard, true);

  /* Picture-in-Picture (standard + iOS presentation mode) */
  const onPip = () => { document.exitPictureInPicture?.().catch(() => {}); setBlackout(true, 'Picture-in-Picture is disabled. Click to resume.'); report('pip'); };
  v.addEventListener('enterpictureinpicture', onPip);
  const onPres = () => { if (v.webkitPresentationMode === 'picture-in-picture') { try { v.webkitSetPresentationMode('inline'); } catch {} onPip(); } };
  v.addEventListener('webkitpresentationmodechanged', onPres);

  /* visualViewport: sudden size jumps (recorder bar / floating windows / shade) outside fullscreen */
  const vv = window.visualViewport;
  let vvBaseH = vv ? vv.height : 0, vvBaseW = vv ? vv.width : 0, vvScale = vv ? vv.scale : 1, vvTimer = 0;
  const resetVV = () => { if (vv) { vvBaseH = vv.height; vvBaseW = vv.width; vvScale = vv.scale; } };
  const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement || isPseudoFs);
  const onVV = () => {
    if (halted || !vv) return;
    clearTimeout(vvTimer); vvTimer = setTimeout(resetVV, 600);   // re-baseline after things settle
    if (inFs() || performance.now() < graceUntil) return resetVV();
    if (vv.scale !== vvScale) return resetVV();                   // pinch-zoom
    if ((vv.width > vv.height) !== (vvBaseW > vvBaseH)) return resetVV(); // rotation
    const dh = Math.abs(vv.height - vvBaseH) / Math.max(vvBaseH, 1), dw = Math.abs(vv.width - vvBaseW) / Math.max(vvBaseW, 1);
    if (dh > VV_THRESHOLD || dw > VV_THRESHOLD) guardLog('viewport-change');   // informational only, no blackout
  };
  vv && vv.addEventListener('resize', onVV);
  const onOrient = () => { graceUntil = performance.now() + 2500; resetVV(); };
  addEventListener('orientationchange', onOrient);
  screen.orientation && screen.orientation.addEventListener && screen.orientation.addEventListener('change', onOrient);

  /* ---------- Tamper guard: MutationObserver + 1s interval ---------- */
  function check() {
    if (halted) return;
    if (!box.isConnected || !canvas.isConnected || !box.contains(canvas) || !box.contains(v) || !box.contains(blk)) return halt('player modified');
    let op = 1;
    for (let el = canvas; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return halt('player hidden');
      op *= parseFloat(cs.opacity);
      if (el === box) break;
    }
    if (op < 0.9) return halt('player hidden');
    const r = canvas.getBoundingClientRect();
    if (r.width < 200 || r.height < 100) return halt('player hidden');
    if (performance.now() >= graceUntil) {
      const vr = v.getBoundingClientRect();
      if (Math.abs(vr.width - r.width) > 6 || Math.abs(vr.height - r.height) > 6) return halt('player modified');
    }
    let envOk = true;
    for (const k in NATIVE) {
      const cur = k === 'getContext' ? HTMLCanvasElement.prototype[k] : _CP[k];
      if (cur !== NATIVE[k] || !isNativeFn(cur)) { envOk = false; break; }
    }
    if (envOk && (Object.prototype.hasOwnProperty.call(ctx, 'fillText') || Object.prototype.hasOwnProperty.call(ctx, 'getImageData') ||
        Object.prototype.hasOwnProperty.call(canvas, 'getContext'))) envOk = false;
    if (!envOk) {
      const t = performance.now();
      if (t - lastEnvStrike > 900) {          // count at most one strike per check window
        envStrikes++;
        lastEnvStrike = t;
        guardLog('environment-strike-' + envStrikes);
      }
      if (envStrikes >= 3) return halt('environment modified');   // 3 consecutive strong signals (Brave/Firefox safe)
    } else { envStrikes = 0; lastEnvStrike = 0; }
    try {
      const d = NATIVE.getImageData.call(ctx, 0, 0, 1, 1).data;
      const canaryOk = Math.abs(d[0] - CANARY[0]) <= 2 && Math.abs(d[1] - CANARY[1]) <= 2 && Math.abs(d[2] - CANARY[2]) <= 2;
      if (!canaryOk || !wmPresent()) { if (++bad > 3) return halt('watermark missing'); } else bad = 0;
    } catch { if (++bad > 3) return halt('canvas tainted'); }
    if (!inFs() && (outerWidth - innerWidth > 200 || outerHeight - innerHeight > 200) && Date.now() - lastDevRep > 30000) {
      lastDevRep = Date.now(); report('devtools?');
    }
  }
  const checkTimer = setInterval(check, 1000);
  const mo = new MutationObserver(() => check());
  mo.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'width', 'height'] });
  if (box.parentNode) mo.observe(box.parentNode, { childList: true });

  /* ---------- Heartbeat (halt only on 401/403/409; retry with backoff otherwise) ---------- */
  async function report(ev) { if (HB) try { await fetch(HB, { method: 'POST', body: JSON.stringify({ ev, cid: CID }), credentials: 'omit', keepalive: true }); } catch {} }
  const scheduleBeat = (ms) => { clearTimeout(beatTimer); if (!halted && HB) beatTimer = setTimeout(beat, ms); };
  async function beat() {
    if (halted || !HB) return;
    try {
      const r = await fetch(HB, { method: 'POST', body: JSON.stringify({ ev: 'beat', t: v.currentTime, cid: CID }), credentials: 'omit' });
      if (r.status === 401 || r.status === 403 || r.status === 409) {
        if (r.status === 403) {
          const d = await r.json().catch(() => ({}));
          if (d.code === 'DEVICE_LIMIT') {
            toast(DEVICE_LIMIT_MSG);
            return halt('device limit reached - contact the administration to reset your devices');
          }
          return halt('account suspended');
        }
        return halt(r.status === 409 ? 'signed in on another device' : 'session expired');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      beatFails = 0;
      engine.rotate(data);
      if (data.label) {
        wmLabel = data.label.includes(session.id) ? data.label : `${data.label} \u00b7 ${session.id}`;
        drawWm();
      }
      scheduleBeat(20000);
    } catch {
      beatFails = Math.min(beatFails + 1, 4);
      const delay = Math.min(30000, 2000 * Math.pow(2, beatFails - 1));
      toast('Connection lost — reconnecting...');
      scheduleBeat(delay);
    }
  }
  beat();

  /* ---------- Playback controls ---------- */
  const saved = +ls.get(key);
  v.addEventListener('loadedmetadata', () => {
    if (saved > 5 && saved < v.duration - 15) { v.currentTime = saved; toast('Resumed at ' + fmt(saved)) }
    if (Number.isFinite(v.duration) && v.duration > 0) {
      const mins = Math.max(1, Math.round(v.duration / 60));
      const metaEl = $('#lMeta');
      if (metaEl && !metaEl.textContent.includes('min')) {
        metaEl.textContent = `${metaEl.textContent} · ${mins} min`;
      }
    }
  }, { once: true });

  const upd = () => { const d = v.duration || 0; $$('#seek').value = d ? v.currentTime / d * 1000 : 0; $$('#seek').style.setProperty('--p', (d ? v.currentTime / d * 100 : 0) + '%'); $$('#tm').textContent = fmt(v.currentTime) + ' / ' + fmt(d) };
  v.ontimeupdate = () => { upd(); if (Date.now() - last > 4000 && v.duration) { last = Date.now(); ls.set(key, v.currentTime); ls.set('dg:prog:' + l.id, v.currentTime / v.duration) } };
  const tog = () => { if (halted || isBlackout) return; v.paused ? v.play().catch(() => {}) : v.pause() };
  let streamTimer = 0;
  async function sendStreamPing() {
    if (halted || isBlackout || !CFG.API || !session?.token) return;
    try {
      const r = await fetch(CFG.API + CFG.STREAM_PING, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
        body: JSON.stringify({ cid: CID, slug: l.id }),
      });
      if (r.status === 409) {
        const d = await r.json().catch(() => ({}));
        return halt(d.error || STREAM_CONFLICT_MSG);
      }
      if (r.status === 403) return halt('account suspended');
    } catch {}
  }
  const startStreamPing = () => {
    clearInterval(streamTimer);
    if (!halted && CFG.API) {
      sendStreamPing();
      streamTimer = setInterval(sendStreamPing, 10000);
    }
  };
  const stopStreamPing = () => { clearInterval(streamTimer); streamTimer = 0; };

  v.onplay = () => { box.classList.add('playing'); $$('#pp').setAttribute('aria-label', 'Pause'); startStreamPing(); };
  v.onpause = () => { box.classList.remove('playing'); $$('#pp').setAttribute('aria-label', 'Play'); stopStreamPing(); };
  v.onended = () => { ls.set('dg:prog:' + l.id, 1); if (nextLec) toast('Next: ' + nextLec.title) };

  v.onclick = () => { if (box.classList.contains('idle')) wake(); else tog(); };
  $$('.big').onclick = tog; $$('#pp').onclick = tog; $$('#bk').onclick = () => v.currentTime -= 10; $$('#fw').onclick = () => v.currentTime += 10;
  $$('#seek').oninput = e => { v.currentTime = e.target.value / 1000 * v.duration };
  const vs = $$('#vol'), sync = () => { if (isBlackout) return; const x = v.muted ? 0 : v.volume; vs.value = x; vs.style.setProperty('--p', x * 100 + '%'); box.classList.toggle('muted', x === 0) };
  vs.oninput = e => { v.volume = +e.target.value; v.muted = +e.target.value === 0 }; v.onvolumechange = sync;
  $$('#mu').onclick = () => { if (isBlackout) return; if (v.muted || v.volume === 0) { v.muted = false; if (v.volume === 0) v.volume = .6 } else v.muted = true }; sync();

  const syncFsStyles = () => {
    graceUntil = performance.now() + 1000;
    const fsActive = inFs();
    v.style.height = fsActive ? '100%' : 'auto';
    v.style.aspectRatio = fsActive ? 'auto' : '16/9';
    resetVV();
  };
  const PSEUDO_FS = 'position:fixed;inset:0;width:100vw;height:100dvh;z-index:2147483647;background:#000;display:flex;align-items:center;justify-content:center';
  $$('#fs').onclick = async () => {
    graceUntil = performance.now() + 1000;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
    else if (isPseudoFs) { isPseudoFs = false; box.style.cssText = BASE_CSS; }
    else {
      const req = box.requestFullscreen || box.webkitRequestFullscreen;
      if (req) {
        try { await req.call(box); }
        catch { isPseudoFs = true; box.style.cssText = PSEUDO_FS; }
      } else { isPseudoFs = true; box.style.cssText = PSEUDO_FS; }
    }
    syncFsStyles();
  };
  document.addEventListener('fullscreenchange', syncFsStyles);

  $$('#sp').onclick = () => menu($$('#sp').parentNode, ['1x', '1.25x', '1.5x', '2x'], $$('#sp').textContent, x => { $$('#sp').textContent = x; v.playbackRate = parseFloat(x) });
  function menu(host, items, cur, pick) {
    const o = host.querySelector('.pop'); if (o) return o.remove();
    const p = document.createElement('div'); p.className = 'pop';
    p.innerHTML = items.map(x => `<button class="${x === cur ? 'cur' : ''}">${x}</button>`).join('');
    p.onclick = e => { if (e.target.tagName === 'BUTTON') { pick(e.target.textContent); p.remove() } }; host.appendChild(p);
  }

  const wake = () => { box.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => box.classList.add('idle'), 2500) };
  box.onmousemove = box.ontouchstart = wake; wake();
  const kd = e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
    const k = e.key.toLowerCase(), m = { ' ': tog, k: tog, j: () => v.currentTime -= 10, l: () => v.currentTime += 10, arrowleft: () => v.currentTime -= 5, arrowright: () => v.currentTime += 5, m: () => { if (!isBlackout) v.muted = !v.muted }, f: () => $$('#fs').click() };
    if (m[k] && !(e.target.tagName === 'BUTTON' && k === ' ')) { e.preventDefault(); m[k](); wake() }
  };
  addEventListener('keydown', kd);

  /* ---------- Cleanup ---------- */
  return () => {
    halted = true;
    mo.disconnect(); ro.disconnect();
    removeEventListener('keydown', kd); removeEventListener('blur', onBlur); removeEventListener('focus', onFocus);
    removeEventListener('pagehide', onHide); document.removeEventListener('freeze', onHide);
    removeEventListener('keydown', onKeyGuard, true); removeEventListener('keyup', onKeyGuard, true);
    removeEventListener('orientationchange', onOrient);
    screen.orientation && screen.orientation.removeEventListener && screen.orientation.removeEventListener('change', onOrient);
    vv && vv.removeEventListener('resize', onVV);
    document.removeEventListener('visibilitychange', onVis); document.removeEventListener('fullscreenchange', syncFsStyles);
    clearInterval(wt); clearInterval(checkTimer); clearTimeout(beatTimer); clearTimeout(shotTimer); clearTimeout(idle); clearTimeout(vvTimer);
    stopStreamPing();
    engine.destroy(); v.removeAttribute('src'); v.load(); box.innerHTML = ''; box.style.cssText = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
}
boot();
initGoogleAuth();
