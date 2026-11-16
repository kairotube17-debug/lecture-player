/* Dr. Gendy — phone/email+password auth, Brevo Email OTP signup, protected canvas/heartbeat/deterrence player. */
const CFG = {
  API: 'https://lecture-vod.bazabezo-ana.workers.dev',
  SIGNUP: '/api/signup',         // POST {name, phone, email, password} -> {ok, phone, email}
  RESEND_OTP: '/api/resend-otp', // POST {phone} -> {ok, email}
  VERIFY_OTP: '/api/verify-otp', // POST {phone, otp} -> {token, name, id}
  LOGIN: '/api/login',           // POST {id, code} -> {token, name, id}
  CATALOG: '/api/catalog',       // GET (Bearer token) -> same shape as data/courses.json
  PLAY: '/api/play/',            // GET /api/play/<lectureId> (Bearer) -> {url, hb}
  DEMO_DATA: 'data/courses.json'
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls = { get: k => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } };
let session = JSON.parse(sessionStorage.getItem('dg:s') || 'null'), catalog = [], course = null, cleanup = null;
let pendingPhone = '', resendTimer = 0;

const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200) };
const fmt = s => { s = Math.max(0, s | 0); const h = s / 3600 | 0, m = (s % 3600) / 60 | 0; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0') };
const auth = () => ({ headers: { Authorization: 'Bearer ' + (session?.token || '') } });

/* theme */
$('#theme').onclick = () => { const d = document.documentElement, n = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = n; ls.set('dg:theme', n) };

/* auth view switching + resend cooldown */
function showAuthCard(which) {
  $('#loginForm').hidden = which !== 'login';
  $('#signupForm').hidden = which !== 'signup';
  $('#otpForm').hidden = which !== 'otp';
  $('#loginErr').textContent = $('#signupErr').textContent = $('#otpErr').textContent = '';
}
function startResendCooldown(sec = 60) {
  clearInterval(resendTimer);
  const btn = $('#resendOtp');
  let rem = sec;
  const tick = () => {
    if (rem <= 0) {
      clearInterval(resendTimer);
      btn.disabled = false;
      btn.textContent = 'Resend Code';
    } else {
      btn.disabled = true;
      btn.textContent = `Resend Code (${rem}s)`;
      rem--;
    }
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}
$('#toSignup').onclick = () => showAuthCard('signup');
$('#toLogin').onclick = () => showAuthCard('login');
$('#otpBack').onclick = () => { clearInterval(resendTimer); showAuthCard('signup'); };

/* sign in */
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#loginErr'); err.textContent = '';
  const sid = String(f.get('id') || '').trim();
  const code = String(f.get('code') || '').trim();
  try {
    let r = { token: 'demo', id: sid, name: sid };
    if (CFG.API) {
      const res = await fetch(CFG.API + CFG.LOGIN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sid, code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) throw new Error('Wrong mobile/email or password.');
        if (res.status === 429) throw new Error(data.error || 'Too many attempts. Try again in 10 minutes.');
        throw new Error(data.error || 'Server error. Try again.');
      }
      r = data;
    }
    session = { token: r.token, id: r.id || sid, name: r.name || sid };
    sessionStorage.setItem('dg:s', JSON.stringify(session)); boot();
  } catch (x) { err.textContent = x.message || 'Could not sign in. Check your connection.' }
};

/* sign up -> Brevo Email OTP */
$('#signupForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#signupErr'), btn = $('#signupBtn');
  err.textContent = '';
  const name = String(f.get('name') || '').trim();
  const phone = String(f.get('phone') || '').trim();
  const email = String(f.get('email') || '').trim();
  const password = String(f.get('password') || '');
  btn.disabled = true; btn.textContent = 'Sending code...';
  try {
    const res = await fetch(CFG.API + CFG.SIGNUP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign up failed.');
    pendingPhone = data.phone;
    $('#otpSub').textContent = `We sent a 6-digit code to ${data.email}. Check your inbox (and Spam folder).`;
    showAuthCard('otp');
    startResendCooldown(60);
  } catch (x) {
    err.textContent = x.message || 'Could not start verification.';
  } finally {
    btn.disabled = false; btn.textContent = 'Send Verification Code';
  }
};

/* resend OTP */
$('#resendOtp').onclick = async () => {
  const err = $('#otpErr'); err.textContent = '';
  if (!pendingPhone) return showAuthCard('signup');
  try {
    const res = await fetch(CFG.API + CFG.RESEND_OTP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: pendingPhone })
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

/* verify OTP */
$('#otpForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), err = $('#otpErr'), btn = $('#verifyBtn');
  err.textContent = '';
  const otp = String(f.get('otp') || '').trim();
  btn.disabled = true; btn.textContent = 'Verifying...';
  try {
    const res = await fetch(CFG.API + CFG.VERIFY_OTP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: pendingPhone, otp })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Invalid or expired OTP.');
    clearInterval(resendTimer);
    session = { token: data.token, id: data.id || pendingPhone, name: data.name || pendingPhone };
    sessionStorage.setItem('dg:s', JSON.stringify(session));
    toast('Account verified!');
    boot();
  } catch (x) {
    err.textContent = x.message || 'Verification failed.';
  } finally {
    btn.disabled = false; btn.textContent = 'Verify & Activate';
  }
};

$('#logout').onclick = () => { sessionStorage.removeItem('dg:s'); session = null; location.hash = '#/'; showAuthCard('login'); boot() };

async function boot() {
  $('#login').hidden = !!session; $('#app').hidden = !session;
  if (!session) return;
  $('#who').textContent = session.name; $('#hi').textContent = 'Welcome, ' + session.name;
  try {
    const res = await fetch(CFG.API ? CFG.API + CFG.CATALOG : CFG.DEMO_DATA, CFG.API ? auth() : {});
    if (res.status === 401) return $('#logout').click();
    catalog = (await res.json()).courses || [];
  } catch { catalog = []; toast('Could not load courses') }
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
      <div><h3>${esc(l.title)}</h3><div class="sub">${on ? (l.duration ? l.duration + ' min' : '') + (p > .02 && p <= .9 ? ' · ' + Math.round(p * 100) + '% watched' : '') : 'Coming soon'}</div></div>
      <div class="chips"><span class="chip ${has(l.pdf)}">PDF</span><span class="chip ${has(l.quiz)}">Quiz</span></div>
      ${on && p > .02 ? `<i class="prog" style="width:${Math.round(p * 100)}%"></i>` : ''}</li>`;
  }).join('') : '<li class="empty">No lectures found.</li>';
}
const go = e => { const li = e.target.closest('.lec[data-id]'); if (li && (e.type === 'click' || e.key === 'Enter')) location.hash = `#/l/${encodeURIComponent(course.id)}/${encodeURIComponent(li.dataset.id)}` };
$('#list').addEventListener('click', go); $('#list').addEventListener('keydown', go);

/* lecture */
async function openLecture(c, l) {
  scrollTo(0, 0);
  const pub = c.lectures.filter(x => x.status === 'published'), k = pub.indexOf(l);
  $('#lTitle').textContent = l.title; $('#lMeta').textContent = c.title + (l.duration ? ' · ' + l.duration + ' min' : '');
  const nav = (b, t) => { b.disabled = !t; b.onclick = () => t && (location.hash = `#/l/${encodeURIComponent(c.id)}/${encodeURIComponent(t.id)}`) };
  nav($('#prev'), pub[k - 1]); nav($('#next'), pub[k + 1]);
  renderPdf(l); renderQuiz(l);
  let playData = l.hls ? { url: l.hls, hb: null } : null;
  if (CFG.API) {
    try {
      const res = await fetch(CFG.API + CFG.PLAY + encodeURIComponent(l.id), auth());
      if (res.status === 401) return $('#logout').click();
      playData = res.ok ? await res.json() : null;
    } catch { playData = null }
  }
  if (location.hash.indexOf(encodeURIComponent(l.id)) < 0) return;
  cleanup = mountPlayer($('#player'), playData, l, pub[k + 1]);
}

function renderPdf(l) {
  const b = $('#pdfBox'), ok = !!l.pdf; b.classList.toggle('off', !ok);
  b.innerHTML = `<div class="phead"><div><h3>Lecture PDF</h3><span class="muted">${ok ? 'Slides and notes for this lecture.' : 'Not uploaded yet.'}</span></div>
  <a class="btn" ${ok ? `href="${esc(l.pdf)}" download target="_blank" rel="noopener"` : 'aria-disabled="true" tabindex="-1"'}>Download PDF</a></div>`;
}

/* quiz */
async function renderQuiz(l) {
  const b = $('#quizBox'); let data = l.quiz;
  if (typeof data === 'string') { try { data = await (await fetch(data)).json() } catch { data = null } }
  const qs = data?.questions || []; b.classList.toggle('off', !qs.length);
  const head = (sub, btn) => `<div class="phead"><div><h3>Quiz</h3><span class="muted">${sub}</span></div>${btn}</div>`;
  if (!qs.length) return b.innerHTML = head('Not available yet.', '<button class="btn" disabled>Start quiz</button>');
  let i, ans, chk;
  const start = () => { i = 0; ans = []; chk = []; draw() };
  b.innerHTML = head(qs.length + ' questions. Check each answer as you go.', '<button class="btn lime" id="qs">Start quiz</button>');
  $('#qs').onclick = start;
  function draw() {
    if (i >= qs.length) return result();
    const q = qs[i], done = chk[i];
    b.innerHTML = `<div class="phead"><h3>Question ${i + 1} of ${qs.length}</h3><span class="muted">${chk.filter(Boolean).length ? chk.reduce((s, c, j) => s + (c && ans[j] === qs[j].answer ? 1 : 0), 0) + ' correct so far' : ''}</span></div>
    <div class="qbar"><i style="width:${i / qs.length * 100}%"></i></div><p class="q">${esc(q.q)}</p>
    <div class="opts">${q.options.map((o, j) => `<button class="opt ${ans[i] === j ? 'sel' : ''} ${done && j === q.answer ? 'right' : ''} ${done && ans[i] === j && j !== q.answer ? 'wrong' : ''}" data-j="${j}" ${done ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
    ${done ? `<p class="fb">${ans[i] === q.answer ? '<b class="r">Correct, 1/1.</b>' : '<b class="w">Incorrect, 0/1.</b>'} ${esc(q.explain || '')}</p>` : ''}
    <div class="qnav"><button class="btn ghost sm" id="qb" ${i ? '' : 'disabled'}>Back</button><span class="grow"></span>
    ${done ? '' : `<button class="btn ghost sm" id="qc" ${ans[i] == null ? 'disabled' : ''}>Check answer</button>`}
    <button class="btn sm" id="qn" ${done ? '' : 'disabled'}>${i === qs.length - 1 ? 'Finish' : 'Next'}</button></div>`;
    b.querySelectorAll('.opt').forEach(o => o.onclick = () => { ans[i] = +o.dataset.j; draw() });
    $('#qb').onclick = () => { i--; draw() }; $('#qn').onclick = () => { i++; draw() };
    const c = $('#qc'); if (c) c.onclick = () => { chk[i] = true; draw() };
  }
  function result() {
    const s = qs.reduce((n, q, j) => n + (ans[j] === q.answer ? 1 : 0), 0);
    b.innerHTML = `<h3>Your result</h3><div class="score">${s}/${qs.length}</div><p class="muted">${Math.round(s / qs.length * 100)}%</p>
    <div class="rev">${qs.map((q, j) => `<div><b class="${ans[j] === q.answer ? 'r' : 'w'}" style="color:var(--${ans[j] === q.answer ? 'ok' : 'bad'})">${ans[j] === q.answer ? 'Correct' : 'Incorrect'}</b> · ${esc(q.q)}<br><span class="muted">Your answer: ${esc(q.options[ans[j]] ?? 'none')}${ans[j] === q.answer ? '' : ' · Correct: ' + esc(q.options[q.answer])}</span></div>`).join('')}</div>
    <div class="qnav"><button class="btn ghost sm" id="qr">Review questions</button><span class="grow"></span><button class="btn sm" id="qa">Try again</button></div>`;
    $('#qa').onclick = start; $('#qr').onclick = () => { i = 0; draw() };
  }
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

/* player: canvas-composited watermark + deterrence + rolling token heartbeat */
function mountPlayer(box, playData, l, nextLec) {
  box.className = 'player';
  const url = typeof playData === 'string' ? playData : playData?.url;
  const HB = typeof playData === 'string' ? null : playData?.hb;
  if (!url) { box.innerHTML = '<div class="empty" style="margin:20px">This video could not be loaded. Refresh or sign in again.</div>'; return }

  box.innerHTML = `
  <video playsinline crossorigin="anonymous" preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture style="position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none"></video>
  <canvas width="1280" height="720" style="width:100%;height:auto;aspect-ratio:16/9;display:block;background:#000;object-fit:contain;cursor:pointer"></canvas>
  <div id="blk" style="position:absolute;inset:0;background:#000;color:#fff;display:none;align-items:center;justify-content:center;text-align:center;padding:24px;z-index:20;font:600 15px/1.5 system-ui,sans-serif;cursor:pointer"></div>
  <button class="big" aria-label="Play or pause"><span class="bp">${svg('play', '', 34)}</span></button>
  <div class="ctl"><input id="seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
  <div class="row"><button class="cb" id="pp" aria-label="Play">${svg('play', 'i-play')}${svg('pause', 'i-pause')}</button>
  <button class="cb" id="bk" aria-label="Back 10 seconds">${svg('back')}</button><button class="cb" id="fw" aria-label="Forward 10 seconds">${svg('fwd')}</button>
  <span class="volwrap"><button class="cb" id="mu" aria-label="Mute">${svg('vol', 'i-vol')}${svg('mute', 'i-mute')}</button><input class="vol" id="vol" type="range" min="0" max="1" step=".02" value="1" aria-label="Volume"></span>
  <span class="time" id="tm">0:00 / 0:00</span><span class="grow"></span>
  <span class="pwrap"><button class="cb pill" id="sp">1x</button></span><span class="pwrap" id="qw" hidden><button class="cb pill" id="ql">Auto</button></span><button class="cb" id="fs" aria-label="Fullscreen">${svg('full')}</button></div></div>`;

  const v = box.querySelector('video'), canvas = box.querySelector('canvas'), blk = box.querySelector('#blk');
  const $$ = s => box.querySelector(s), key = 'dg:pos:' + l.id;
  v.disableRemotePlayback = true;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const nativeFillText = CanvasRenderingContext2D.prototype.fillText;
  const nativeDraw = CanvasRenderingContext2D.prototype.drawImage;
  const nativeGet = CanvasRenderingContext2D.prototype.getImageData;

  const CID = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  const nonce = crypto.getRandomValues(new Uint8Array(3));
  const CANARY = [8 + (nonce[0] & 15), 8 + (nonce[1] & 15), 8 + (nonce[2] & 15)];

  let hls = null, token = null, halted = false, isBlackout = false, last = 0, idle = 0, rafId = 0, bad = 0, isPseudoFs = false;
  let wmLabel = `${session.name} · ${session.id}`;
  let wmX = 0.08 + Math.random() * 0.56, wmY = 0.10 + Math.random() * 0.72;

  const stopEv = e => e.preventDefault();
  box.addEventListener('contextmenu', stopEv);
  box.addEventListener('dragstart', stopEv);

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      maxBufferLength: 40,
      xhrSetup(xhr, reqUrl) {
        if (token) reqUrl = reqUrl.replace(/\/vod\/[^/]+\/\d+\//, `/vod/${token.t}/${token.exp}/`);
        xhr.open('GET', reqUrl, true);
      }
    });
    hls.loadSource(url);
    hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const hs = [...new Set(hls.levels.map(x => x.height))].filter(Boolean).sort((a, b) => b - a);
      if (hs.length > 1) {
        $$('#qw').hidden = false;
        $$('#ql').onclick = () => menu($$('#qw'), ['Auto', ...hs.map(h => h + 'p')], $$('#ql').textContent, x => {
          $$('#ql').textContent = x;
          hls.currentLevel = x === 'Auto' ? -1 : hls.levels.findIndex(y => y.height === parseInt(x));
        });
      }
    });
    hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { d.type === Hls.ErrorTypes.NETWORK_ERROR ? hls.startLoad() : hls.recoverMediaError() } });
  } else {
    v.src = url;
  }

  function drawFrame() {
    if (halted) return;
    const w = canvas.width, h = canvas.height;
    if (isBlackout) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      return;
    }
    nativeDraw.call(ctx, v, 0, 0, w, h);
    ctx.save();
    ctx.font = `${Math.max(16, Math.round(h / 28))}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    nativeFillText.call(ctx, wmLabel, wmX * w, wmY * h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgb(${CANARY[0]},${CANARY[1]},${CANARY[2]})`;
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
  }
  function loop() {
    cancelAnimationFrame(rafId);
    if (halted || isBlackout) return;
    drawFrame();
    if (!v.paused && !v.ended) rafId = requestAnimationFrame(loop);
  }
  const moveWm = () => { wmX = 0.06 + Math.random() * 0.56; wmY = 0.08 + Math.random() * 0.76; if (v.paused && !isBlackout) drawFrame(); };
  const wt = setInterval(moveWm, 10000);

  function setBlackout(on, reason) {
    if (halted) return;
    isBlackout = on;
    if (on) {
      v.pause();
      cancelAnimationFrame(rafId);
      drawFrame();
      blk.textContent = reason || 'Playback paused (window inactive). Click to resume.';
      blk.style.display = 'flex';
    } else {
      blk.style.display = 'none';
      drawFrame();
    }
  }
  function halt(why) {
    if (halted) return;
    halted = true; isBlackout = true;
    cancelAnimationFrame(rafId);
    v.pause(); hls && hls.stopLoad();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    blk.textContent = 'Playback stopped: ' + why;
    blk.style.display = 'flex';
    report('halt:' + why);
  }

  blk.onclick = () => {
    if (halted || document.hidden || !document.hasFocus()) return;
    setBlackout(false);
    v.play().catch(() => {});
  };

  const onVis = () => { if (document.hidden) setBlackout(true, 'Playback paused while tab is hidden. Click to resume.'); };
  const onBlur = () => { if (!halted) setBlackout(true, 'Playback paused (window lost focus). Click to resume.'); };
  const onFocus = () => { if (!halted && !document.hidden && isBlackout) blk.textContent = 'Playback paused for protection. Click to resume.'; };
  const onKeyGuard = e => {
    const k = (e.key || '').toLowerCase();
    const isDev = k === 'f12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k)) || (e.ctrlKey && k === 'u');
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
      e.preventDefault();
      setBlackout(true, 'Screen capture is disabled. Click to resume.');
      toast('Screen capture is disabled');
      report('halt:printscreen');
    } else if (isDev) {
      e.preventDefault();
      setBlackout(true, 'Developer tools are disabled during playback. Click to resume.');
      report('devtools?');
    }
  };
  document.addEventListener('visibilitychange', onVis);
  addEventListener('blur', onBlur);
  addEventListener('focus', onFocus);
  addEventListener('keydown', onKeyGuard, true);
  addEventListener('keyup', onKeyGuard, true);

  function check() {
    if (halted) return;
    if (!box.contains(canvas) || !canvas.isConnected) return halt('player modified');
    const r = canvas.getBoundingClientRect();
    if (r.width < 200 || r.height < 100 || getComputedStyle(canvas).visibility !== 'visible' ||
        getComputedStyle(canvas).opacity < 0.9 || getComputedStyle(canvas).display === 'none') return halt('player hidden');
    for (const fn of [CanvasRenderingContext2D.prototype.fillText, CanvasRenderingContext2D.prototype.drawImage,
                      CanvasRenderingContext2D.prototype.getImageData, HTMLCanvasElement.prototype.getContext])
      if (!/\[native code\]/.test(Function.prototype.toString.call(fn))) return halt('environment modified');
    if (!v.paused && !isBlackout) {
      try {
        const d = nativeGet.call(ctx, 0, 0, 1, 1).data;
        if (Math.abs(d[0] - CANARY[0]) > 2 || Math.abs(d[1] - CANARY[1]) > 2 || Math.abs(d[2] - CANARY[2]) > 2) {
          if (++bad > 3) return halt('watermark missing');
        } else bad = 0;
      } catch {
        if (++bad > 3) return halt('canvas tainted');
      }
    } else bad = 0;
    if (!isPseudoFs && !document.fullscreenElement && (outerWidth - innerWidth > 200 || outerHeight - innerHeight > 200))
      report('devtools?');
  }
  const checkTimer = setInterval(check, 1000);

  async function report(ev) { if (HB) try { await fetch(HB, { method: 'POST', body: JSON.stringify({ ev, cid: CID }), credentials: 'omit', keepalive: true }); } catch {} }
  async function beat() {
    if (halted || !HB) return;
    try {
      const r = await fetch(HB, { method: 'POST', body: JSON.stringify({ ev: 'beat', t: v.currentTime, cid: CID }), credentials: 'omit' });
      if (r.status === 409) return halt('signed in on another device');
      if (!r.ok) return halt('session ended');
      token = await r.json();
      if (token.label) {
        wmLabel = token.label.includes(session.id) ? token.label : `${token.label} · ${session.id}`;
        if (v.paused && !isBlackout) drawFrame();
      }
    } catch {}
  }
  const beatTimer = setInterval(beat, 20000);
  beat();

  const saved = +ls.get(key);
  v.addEventListener('loadedmetadata', () => { if (saved > 5 && saved < v.duration - 15) { v.currentTime = saved; toast('Resumed at ' + fmt(saved)) } }, { once: true });
  v.addEventListener('loadeddata', drawFrame);
  v.addEventListener('seeked', drawFrame);

  const upd = () => { const d = v.duration || 0; $$('#seek').value = d ? v.currentTime / d * 1000 : 0; $$('#seek').style.setProperty('--p', (d ? v.currentTime / d * 100 : 0) + '%'); $$('#tm').textContent = fmt(v.currentTime) + ' / ' + fmt(d) };
  v.ontimeupdate = () => { upd(); if (Date.now() - last > 4000 && v.duration) { last = Date.now(); ls.set(key, v.currentTime); ls.set('dg:prog:' + l.id, v.currentTime / v.duration) } };
  const tog = () => { if (halted || isBlackout) return; v.paused ? v.play() : v.pause() };
  v.onplay = () => { box.classList.add('playing'); $$('#pp').setAttribute('aria-label', 'Pause'); loop() };
  v.onpause = () => { box.classList.remove('playing'); $$('#pp').setAttribute('aria-label', 'Play'); cancelAnimationFrame(rafId) };
  v.onended = () => { ls.set('dg:prog:' + l.id, 1); if (nextLec) toast('Next: ' + nextLec.title) };

  canvas.onclick = () => { if (box.classList.contains('idle')) wake(); else tog(); };
  $$('.big').onclick = tog; $$('#pp').onclick = tog; $$('#bk').onclick = () => v.currentTime -= 10; $$('#fw').onclick = () => v.currentTime += 10;
  $$('#seek').oninput = e => { v.currentTime = e.target.value / 1000 * v.duration };
  const vs = $$('#vol'), sync = () => { const x = v.muted ? 0 : v.volume; vs.value = x; vs.style.setProperty('--p', x * 100 + '%'); box.classList.toggle('muted', x === 0) };
  vs.oninput = e => { v.volume = +e.target.value; v.muted = +e.target.value === 0 }; v.onvolumechange = sync;
  $$('#mu').onclick = () => { if (v.muted || v.volume === 0) { v.muted = false; if (v.volume === 0) v.volume = .6 } else v.muted = true }; sync();

  const syncFsStyles = () => {
    const fsActive = !!(document.fullscreenElement || document.webkitFullscreenElement || isPseudoFs);
    canvas.style.height = fsActive ? '100%' : 'auto';
    canvas.style.maxHeight = fsActive ? '100%' : '';
  };
  $$('#fs').onclick = async () => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
    } else if (isPseudoFs) {
      isPseudoFs = false;
      box.style.cssText = '';
    } else {
      const req = box.requestFullscreen || box.webkitRequestFullscreen;
      if (req) {
        try { await req.call(box); }
        catch {
          isPseudoFs = true;
          box.style.cssText = 'position:fixed;inset:0;width:100vw;height:100dvh;z-index:2147483647;background:#000;display:flex;align-items:center;justify-content:center';
        }
      } else {
        isPseudoFs = true;
        box.style.cssText = 'position:fixed;inset:0;width:100vw;height:100dvh;z-index:2147483647;background:#000;display:flex;align-items:center;justify-content:center';
      }
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
    const k = e.key.toLowerCase(), m = { ' ': tog, k: tog, j: () => v.currentTime -= 10, l: () => v.currentTime += 10, arrowleft: () => v.currentTime -= 5, arrowright: () => v.currentTime += 5, m: () => v.muted = !v.muted, f: () => $$('#fs').click() };
    if (m[k] && !(e.target.tagName === 'BUTTON' && k === ' ')) { e.preventDefault(); m[k](); wake() }
  };
  addEventListener('keydown', kd);

  return () => {
    halted = true;
    cancelAnimationFrame(rafId);
    removeEventListener('keydown', kd);
    removeEventListener('blur', onBlur);
    removeEventListener('focus', onFocus);
    removeEventListener('keydown', onKeyGuard, true);
    removeEventListener('keyup', onKeyGuard, true);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('fullscreenchange', syncFsStyles);
    clearInterval(wt); clearInterval(checkTimer); clearInterval(beatTimer); clearTimeout(idle);
    hls && hls.destroy(); v.removeAttribute('src'); v.load(); box.innerHTML = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
}
boot();
