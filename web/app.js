/* Fight Arena front end (minimal): home, QR lobby, join form, fight show, explained results. */
(function () {
  const app = document.getElementById('app');
  const badge = document.getElementById('room-badge');
  const toastEl = document.getElementById('toast');
  const COLORS = ['#d20a0a', '#1d4ed8', '#d4af37', '#16a34a', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#9ca3af'];
  const LEVELS = ['Never trained', 'Tried it', 'Train regularly', '2+ years, spar hard', 'Competitor', 'Pro level'];
  const SKILLS = [['striking', 'Striking', 'boxing, kickboxing'], ['wrestling', 'Wrestling', 'takedowns, judo'], ['grappling', 'Grappling', 'BJJ, submissions']];
  const METHOD = { KO: 'KO', SUB: 'submission', DEC: 'decision' };
  const S = { code: null, room: null, version: null, view: null, poll: null, show: null, mode: 'ranking', topK: 3 };

  // ------------------------------------------------------------------ utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (p) => `${Math.round(p * 100)}%`;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.hidden = true; }, 3000); }
  async function api(path, opts = {}) {
    const res = await fetch(path, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = data.detail || `Something went wrong (${res.status})`;
      if (Array.isArray(msg)) msg = msg.map((d) => `${(d.loc || []).slice(-1)[0]}: ${d.msg}`).join('; ');
      throw new Error(msg);
    }
    return data;
  }
  const sound = () => { if (window.Sfx && !window.Sfx.enabled) window.Sfx.enable(); };
  const hostToken = (code) => store.get(`arena:host:${code}`);
  const myPlayer = (code) => store.get(`arena:player:${code}`);
  const players = () => (S.room?.players || []);
  const playerById = (id) => players().find((p) => p.id === id);
  const nameOf = (id) => playerById(id)?.name || 'Fighter';
  const colorOf = (id) => { const i = players().findIndex((p) => p.id === id); return COLORS[Math.max(0, i) % COLORS.length]; };
  const dot = (id) => `<span class="dot" style="background:${colorOf(id)}"></span>`;
  // cartoon avatar generated from the player's id + name (same face everywhere, also in the fight)
  const av = (id, size, mood) => {
    const p = playerById(id) || { name: '', sex: 'M' };
    const svg = window.Avatar.svg(window.Avatar.seed(id, p.name), { color: colorOf(id), sex: p.sex, mood: mood || 'normal' });
    return `<span class="av${size >= 100 ? ' big' : ''}" data-id="${id}" data-mood="${mood || 'normal'}" style="width:${size}px;height:${size}px">${svg}</span>`;
  };

  // ---------------------------------------------------------------- fun effects
  function floaty(x, y, emoji) {
    const el = document.createElement('div');
    el.className = 'floaty'; el.textContent = emoji;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 60}deg`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }
  function confetti(n) {
    const c = document.createElement('canvas');
    c.className = 'confetti'; document.body.appendChild(c);
    const ctx = c.getContext('2d'), W = (c.width = innerWidth), H = (c.height = innerHeight);
    const cols = ['#ff3d8b', '#ff8a3d', '#ffc83d', '#7c5cff', '#22c4dd', '#22c55e'];
    const ps = Array.from({ length: n || 160 }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 16,
      vy: -6 - Math.random() * 12, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)] }));
    const t0 = performance.now();
    (function tick(now) {
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) { p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.vx *= 0.99; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); ctx.restore(); }
      if (now - t0 < 3200) requestAnimationFrame(tick); else c.remove();
    })(t0);
  }
  // tap any face to bonk it
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.av');
    if (!el || e.target.closest('summary')) return;
    if (window.Sfx) { window.Sfx.enable(); window.Sfx.play('punch', 0.8); }
    floaty(e.clientX, e.clientY - 10, ['💥', '😵', '🤕', '⭐', 'BONK'][Math.floor(Math.random() * 5)]);
    el.classList.remove('bonk'); void el.offsetWidth; el.classList.add('bonk');
    if (el.dataset.id) {
      const p = playerById(Number(el.dataset.id)) || { name: '', sex: 'M' };
      const draw = (mood) => { el.innerHTML = window.Avatar.svg(window.Avatar.seed(Number(el.dataset.id), p.name), { color: colorOf(Number(el.dataset.id)), sex: p.sex, mood }); };
      draw('hit'); setTimeout(() => draw(el.dataset.mood || 'normal'), 700);
    }
  });
  const LOADING = ['Measuring aura…', 'Consulting 385,729 sumo wrestlers…', 'Checking who skipped leg day…', 'Counting push-ups twice…',
    'Estimating reach (nobody measures that)…', 'Asking the judges…'];
  const FACTS = ['In open-weight grappling (ADCC) the heavier athlete wins about 6 matches in 10.',
    'Strength grows slower than bodyweight: twice as heavy is not twice as strong.',
    'In UFC data, being younger helps more than a longer reach.', 'Southpaws get a small edge in the UFC data.',
    '385,729 sumo bouts taught the AI how much size matters.', 'Your push-ups are compared with people of your age and gender.'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ routing
  function go(path) { history.pushState({}, '', path); route(); }
  window.addEventListener('popstate', route);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-nav="home"]')) { e.preventDefault(); go('/'); } });
  function route() {
    stopPolling(); stopShow();
    const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})/);
    if (m) { S.code = m[1].toUpperCase(); badge.textContent = S.code; badge.hidden = false; document.title = "You've been called to fight 🥊 · Fight Arena"; openRoom(); }
    else { S.code = null; badge.hidden = true; document.title = 'Fight Arena'; renderHome(); }
  }
  function stopShow() { if (S.show) { S.show.destroy(); S.show = null; } }

  // ------------------------------------------------------------------ home
  function renderHome() {
    S.view = 'home';
    app.innerHTML = `
      <h1>Who wins<br><span class="pop">in your group?</span></h1>
      <p class="muted">Everyone joins from their phone. An AI trained on real fights decides, and explains why.</p>
      <div class="faces">${['normal', 'hit', 'win', 'ko', 'normal'].map((mood, i) => `<span class="av" style="width:56px;height:56px">${window.Avatar.svg(Math.floor(Math.random() * 1e9), { color: COLORS[i * 2], sex: i === 2 ? 'F' : 'M', mood })}</span>`).join('')}</div>
      <div style="margin-top:32px"><button class="btn" id="create">Create room</button></div>
      <form class="join-row" id="join"><input class="f" id="code" maxlength="5" placeholder="Room code" autocomplete="off" aria-label="Room code"><button class="btn" type="submit">Join</button></form>`;
    document.getElementById('create').onclick = async (e) => {
      e.currentTarget.disabled = true; sound();
      try { const r = await api('/api/rooms', { method: 'POST' }); store.set(`arena:host:${r.code}`, r.host_token); go(`/r/${r.code}`); }
      catch (err) { toast(err.message); e.currentTarget.disabled = false; }
    };
    document.getElementById('join').onsubmit = (e) => {
      e.preventDefault(); sound();
      const code = document.getElementById('code').value.trim().toUpperCase();
      if (code.length >= 4) go(`/r/${code}`);
    };
  }

  // ------------------------------------------------------------------ room
  async function openRoom() {
    app.innerHTML = '<p class="muted" style="margin-top:48px">Loading…</p>';
    try { await refresh(true); startPolling(); }
    catch (err) { app.innerHTML = `<h2>Room not found</h2><p class="muted">${esc(err.message)}</p><a href="/" data-nav="home" class="link">Back</a>`; }
  }
  function startPolling() { stopPolling(); S.poll = setInterval(() => refresh(false).catch(() => {}), 2000); }
  function stopPolling() { if (S.poll) clearInterval(S.poll); S.poll = null; }

  async function refresh(force) {
    const room = await api(`/api/rooms/${S.code}${!force && S.version ? `?since=${S.version}` : ''}`);
    if (room.unchanged && !force) return;                          // nothing new since the last poll
    if (!force && S.version && room.version < S.version) return; // a slow, older response: ignore it
    const changed = room.version !== S.version;
    const before = new Set(players().map((p) => p.id));
    S.room = room; S.version = room.version;
    S.fresh = new Set(before.size || S.view === 'lobby' ? room.players.filter((p) => !before.has(p.id)).map((p) => p.id) : []);
    if (S.view === 'lobby' && S.fresh.size) {
      const names = room.players.filter((p) => S.fresh.has(p.id)).map((p) => p.name);
      toast(names.length > 2 ? `🥊 ${names.length} fighters entered the arena!` : `🥊 ${names.join(' & ')} entered the arena!`);
      if (window.Sfx) window.Sfx.play('bell');
    }
    if (!changed && !force) return;
    if (room.status === 'done') {
      if (S.view !== 'results' || S.resultsId !== room.results.id) renderResults();
      else if (!hostToken(S.code)) {  // guests follow the host; the host drives locally
        if (room.mode === 'tournament') applyBracket(room.state || {}); else applyCursor(room.cursor);
      }
      return;
    }
    if (S.view === 'form') return;
    if (S.view === 'invite') { renderInvite(); return; }
    if (S.view === 'results') { stopShow(); S.view = null; }
    renderLobby();
  }

  function playerRows(removable) {
    const list = players();
    if (!list.length) return '<p class="muted small" style="padding:12px 0">No one yet.</p>';
    return list.map((p) => `<div class="item${S.fresh && S.fresh.has(p.id) ? ' new' : ''}" style="--c:${colorOf(p.id)}">${av(p.id, 40)}<div class="grow">${esc(p.name)} <span class="muted small">${p.height} cm · ${p.weight} kg</span></div>
      ${removable ? `<button class="x" data-kick="${p.id}" aria-label="Remove ${esc(p.name)}">×</button>` : ''}</div>`).join('');
  }

  function renderLobby() {
    const isHost = !!hostToken(S.code);
    const me = myPlayer(S.code);
    const joined = me && players().some((p) => p.id === me.id);
    if (!isHost && !joined) { if (S.accepted === S.code) renderForm(false); else renderInvite(); return; }
    S.view = 'lobby';
    const n = players().length;
    if (!isHost) {
      const mine = playerById(me.id);
      app.innerHTML = `<div class="center" style="margin-top:24px">${av(me.id, 140)}<h2 style="margin:8px 0 4px">${esc(mine.name)}</h2>
          <p class="muted small">You're in. Waiting for the host to start.</p><p class="small fact" id="fact">${FACTS[Math.floor(Math.random() * FACTS.length)]}</p></div>
        <h2>Players · ${n}</h2><div class="list">${playerRows(false)}</div>`;
      clearInterval(S.factTimer);
      let k = 0;
      S.factTimer = setInterval(() => { const el = document.getElementById('fact'); if (!el) { clearInterval(S.factTimer); return; } el.textContent = FACTS[(k += 1) % FACTS.length]; }, 4500);
      return;
    }
    const url = `${location.origin}/r/${S.code}`;
    app.innerHTML = `
      <div class="scan-label">Scan to fight</div>
      <div class="qr"><img src="/api/rooms/${S.code}/qr.svg" alt="QR code to join the fight"></div>
      <div class="bigcode">${esc(S.code)}</div>
      <p class="muted small center">${esc(url)}</p>
      <h2>Players · ${n}</h2>
      <div class="list">${playerRows(true)}</div>
      <p style="margin-top:12px"><button class="link" id="add">Add a player on this device</button> · <button class="link" id="demo">Fill with famous fighters</button></p>
      <h2>Mode</h2>
      <div class="seg" id="mode"><button data-v="ranking" class="${S.mode === 'ranking' ? 'on' : ''}">Ranking</button><button data-v="tournament" class="${S.mode === 'tournament' ? 'on' : ''}">Tournament</button></div>
      ${S.mode === 'ranking' ? `<div class="seg" id="topk" style="margin-top:8px">${[3, 5, 10].map((k) => `<button data-v="${k}" class="${S.topK === k ? 'on' : ''}">Top ${k}</button>`).join('')}</div>` : ''}
      <div style="margin-top:28px"><button class="btn go" id="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Need at least 2 players' : 'Start'}</button></div>`;
    const token = hostToken(S.code);
    document.getElementById('add').onclick = () => renderForm(true);
    document.getElementById('demo').onclick = async () => {
      try { const r = await api(`/api/rooms/${S.code}/demo`, { method: 'POST', body: { host_token: token } }); toast(r.added ? `Added ${r.added} fighters` : 'They are already here'); await refresh(true); }
      catch (err) { toast(err.message); }
    };
    document.querySelectorAll('#mode button').forEach((b) => b.onclick = () => { S.mode = b.dataset.v; renderLobby(); });
    document.querySelectorAll('#topk button').forEach((b) => b.onclick = () => { S.topK = Number(b.dataset.v); renderLobby(); });
    document.querySelectorAll('[data-kick]').forEach((b) => b.onclick = async () => {
      try { await api(`/api/rooms/${S.code}/players/${b.dataset.kick}?host_token=${encodeURIComponent(token)}`, { method: 'DELETE' }); await refresh(true); }
      catch (err) { toast(err.message); }
    });
    document.getElementById('start').onclick = async (e) => {
      const btn = e.currentTarget; sound();
      btn.disabled = true;
      let i = 0; btn.textContent = LOADING[0];
      const spin = setInterval(() => { btn.textContent = LOADING[(i += 1) % LOADING.length]; }, 650);
      try {
        const [room] = await Promise.all([api(`/api/rooms/${S.code}/start`, { method: 'POST', body: { host_token: token, mode: S.mode, top_k: S.topK } }), sleep(1900)]);
        clearInterval(spin);
        // the background refresh may already have opened (or even shuffled) the show meanwhile
        const alreadyShown = S.view === 'results' && (S.resultsId === room.results.id || (S.version && room.version < S.version));
        if (!alreadyShown) { S.room = room; S.version = S.room.version; renderResults(); }
      } catch (err) { clearInterval(spin); toast(err.message); renderLobby(); }
    };
  }

  // ------------------------------------------------------------------ invite (what a phone sees after scanning)
  function renderInvite() {
    S.view = 'invite';
    const list = players();
    const faces = list.slice(0, 6).map((p) => av(p.id, 46)).join('');
    app.innerHTML = `
      <div class="invite">
        <div class="invite-kicker">Fight night · Room ${esc(S.code)}</div>
        <h1>You've been<br><span class="pop">called to fight</span></h1>
        <p class="muted">${list.length ? `${list.length} fighter${list.length > 1 ? 's are' : ' is'} already in the cage. Step in, tell the AI what you've got, and find out who wins.` : 'Be the first one in the cage. Tell the AI what you\'ve got and find out who wins.'}</p>
        ${faces ? `<div class="invite-faces">${faces}${list.length > 6 ? `<span class="more">+${list.length - 6}</span>` : ''}</div>` : ''}
        <div style="margin-top:28px"><button class="btn" id="accept">Accept the fight</button></div>
        <p class="tiny muted center" style="margin-top:10px">Takes 30 seconds. No account needed.</p>
      </div>`;
    document.getElementById('accept').onclick = () => {
      sound(); if (window.Sfx) window.Sfx.play('bell');
      S.accepted = S.code; renderForm(false);
    };
  }

  // ------------------------------------------------------------------ join form (one page)
  function renderForm(hostAdding) {
    S.view = 'form';
    const d = { sex: 'M', hand: 'right', striking: 0, wrestling: 0, grappling: 0 };
    const seg = (field, options) => `<div class="seg" data-field="${field}">${options.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(d[field]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    app.innerHTML = `
      <h2>${hostAdding ? 'Add a fighter' : 'Fighter registration'}</h2>
      <form id="pf" novalidate>
        <label for="name">Name</label><input class="f" id="name" maxlength="24" autocomplete="nickname">
        <label>Gender</label>${seg('sex', [['M', 'Male'], ['F', 'Female']])}
        <div class="cols">
          <div><label for="age">Age</label><input class="f" type="number" id="age" inputmode="numeric"></div>
          <div><label for="height">Height, cm</label><input class="f" type="number" id="height" inputmode="numeric"></div>
          <div><label for="weight">Weight, kg</label><input class="f" type="number" id="weight" inputmode="numeric"></div>
        </div>
        <label>Dominant hand</label>${seg('hand', [['right', 'Right'], ['left', 'Left']])}
        ${SKILLS.map(([k, t, ex]) => `<label>${t} <span class="tiny">· ${ex}</span></label>${seg(k, [0, 1, 2, 3, 4, 5].map((i) => [i, i]))}<div class="caption" id="${k}-cap">${LEVELS[0]}</div>`).join('')}
        <label for="push">Max push-ups in a row <span class="tiny">· optional · women: knee push-ups</span></label>
        <div class="translate">KZ: жерден қатарынан неше рет итеріле аласыз? · RU: сколько раз подряд отжимаетесь?</div>
        <input class="f" type="number" id="push" inputmode="numeric" placeholder="Skip if you don't know">
        <div class="error" id="err" hidden></div>
        <div style="margin-top:28px"><button class="btn" type="submit" id="go">${hostAdding ? 'Add' : 'Join'}</button></div>
        ${hostAdding ? '<p class="center" style="margin-top:12px"><button type="button" class="link" id="cancel">Cancel</button></p>' : ''}
      </form>`;
    document.querySelectorAll('[data-field]').forEach((g) => g.querySelectorAll('button').forEach((b) => b.onclick = () => {
      const f = g.dataset.field;
      d[f] = ['striking', 'wrestling', 'grappling'].includes(f) ? Number(b.dataset.v) : b.dataset.v;
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const cap = document.getElementById(`${f}-cap`); if (cap) cap.textContent = LEVELS[d[f]];
    }));
    const cancel = document.getElementById('cancel');
    if (cancel) cancel.onclick = () => { S.view = null; renderLobby(); };
    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault(); sound();
      const val = (id) => document.getElementById(id).value.trim();
      const body = { name: val('name'), sex: d.sex, hand: d.hand, age: Number(val('age')), height: Number(val('height')), weight: Number(val('weight')),
        striking: d.striking, wrestling: d.wrestling, grappling: d.grappling, pushups: val('push') === '' ? null : Number(val('push')) };
      const bad = [];
      if (!body.name) bad.push('name');
      if (!(body.age >= 14 && body.age <= 80)) bad.push('age 14–80');
      if (!(body.height >= 130 && body.height <= 230)) bad.push('height 130–230');
      if (!(body.weight >= 35 && body.weight <= 200)) bad.push('weight 35–200');
      if (body.pushups !== null && !(body.pushups >= 0 && body.pushups <= 200)) bad.push('push-ups 0–200');
      const err = document.getElementById('err');
      if (bad.length) { err.textContent = `Check: ${bad.join(', ')}.`; err.hidden = false; return; }
      const btn = document.getElementById('go'); btn.disabled = true;
      try {
        const r = await api(`/api/rooms/${S.code}/players`, { method: 'POST', body });
        if (!hostAdding) store.set(`arena:player:${S.code}`, { id: r.player_id, token: r.player_token });
        S.view = null; await refresh(true);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    };
  }

  // ------------------------------------------------------------------ results (host-controlled show)
  // The host drives the show with a shared cursor; guests' screens follow it.
  //   ranking:    0 = battle royale playing, 1 = jumped to the final, 2 = results
  //   tournament: cursor = step * 2 + (1 if the host skipped this fight's animation)
  //               steps: [schedule round 1, fight, fight, ..., schedule round 2, ..., champion]
  function renderResults() {
    stopShow();
    const res = S.room.results;
    S.view = 'results'; S.resultsId = res.id; S.step = -1; S.fightDone = false; S.drawn = false; S.cursor = 0;
    if (res.mode === 'tournament') bracketInit(res);
    app.innerHTML = `<div class="stage" id="stage-wrap"><canvas id="stage" aria-label="Fight animation"></canvas></div>
      <div class="ticker" id="ticker"></div>
      <div class="ctl" id="ctl"></div>
      <div class="reacts" id="reacts">${['🔥', '😂', '💀', '👏', '😱'].map((e) => `<button aria-label="React ${e}">${e}</button>`).join('')}</div>
      <div id="board"></div>`;
    document.querySelectorAll('#reacts button').forEach((b) => b.onclick = () => {
      const r = b.getBoundingClientRect();
      for (let k = 0; k < 3; k++) setTimeout(() => floaty(r.left + r.width / 2, r.top, b.textContent), k * 120);
      if (window.Sfx) window.Sfx.play('boing');
    });
    if (res.mode === 'tournament') applyBracket(S.room.state || {}); else applyCursor(S.room.cursor || 0);
  }

  const isHostHere = () => !!hostToken(S.code);
  const ticker = (t) => { const el = document.getElementById('ticker'); if (el) el.textContent = t; };
  const roster = () => players().map((p) => ({ id: p.id, name: p.name, sex: p.sex, color: colorOf(p.id), height: p.height, weight: p.weight }));
  function newShow(onDone) {
    stopShow();
    S.show = window.ArenaShow.create(document.getElementById('stage'), roster(), { onTicker: ticker, onDone });
    return S.show;
  }
  async function moveCursor(c) {
    S.cursor = c; applyCursor(c);
    try { await api(`/api/rooms/${S.code}/cursor`, { method: 'POST', body: { host_token: hostToken(S.code), cursor: c } }); }
    catch (err) { toast(err.message); }
  }

  function controls(buttons) {
    const el = document.getElementById('ctl');
    if (!el) return;
    if (!isHostHere()) { el.innerHTML = '<p class="tiny muted center">The host controls the show.</p>'; return; }
    el.innerHTML = buttons.map(([id, label, primary]) => `<button class="btn ${primary ? '' : 'ghost'} sm" id="${id}">${label}</button>`).join('');
  }
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };

  function applyCursor(c) {
    S.cursor = c;
    const res = S.room.results;
    return applyRanking(c, res);
  }

  // ---------------- ranking: one battle royale, then the explained ranking
  function applyRanking(c, res) {
    const showResults = () => {
      if (S.drawn) return;
      S.drawn = true; ticker('');
      controls([]);
      drawRanking(res); confetti(180);
    };
    if (c >= 2) { if (S.show && S.show.running) S.show.skip(); else showResults(); return; }
    if (!S.show) {
      const show = newShow(() => { showResults(); if (isHostHere() && S.cursor < 2) moveCursor(2); });
      const onStage = new Set(res.table.map((r) => r.id).slice(0, 12));
      const ids = players().map((p) => p.id).filter((id) => onStage.has(id));
      show.play(window.ArenaShow.brawl(show, ids, Object.assign({}, res.show, { eliminations: res.show.eliminations.filter((e) => onStage.has(e.victim)) }), {}));
      document.getElementById('board').innerHTML = `<p class="muted center small" style="margin-top:16px">Results after the show.</p>${statsSection()}`;
      bindStats();
    }
    if (c === 1 && S.show) S.show.skipTo('final');
    controls(c === 0 ? [['to-final', 'Skip to final'], ['to-results', 'Skip to results']] : [['to-results', 'Skip to results']]);
    on('to-final', () => moveCursor(1));
    on('to-results', () => moveCursor(2));
  }

  // ---------------- tournament: a bracket draw; the host presses ▶ on a fight, everyone watches it
  // Shared state: { played: [fight indices], current: fight on stage or -1, skip: host skipped the animation }
  function bracketInit(res) {
    S.fights = []; S.fidx = {};
    res.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => {
      if (!m.bye) { S.fidx[`${ri}-${mi}`] = S.fights.length; S.fights.push({ ri, mi, m }); }
    }));
    S.bstate = { played: [], current: -1, skip: false };
    S.playing = -1; S.selected = null; S.lastDone = null; S.champShown = false;
  }
  const playedSet = () => new Set(S.bstate.played);
  // a slot is filled once the fight that feeds it has been shown (round 1 is the draw itself)
  function slotKnown(ri, mi, side) {
    if (ri === 0) return true;
    const feed = S.room.results.rounds[ri - 1].matches[2 * mi + side];
    return feed.bye || playedSet().has(S.fidx[`${ri - 1}-${2 * mi + side}`]);
  }
  function playable(f) {
    const { ri, mi } = S.fights[f];
    return !playedSet().has(f) && slotKnown(ri, mi, 0) && slotKnown(ri, mi, 1);
  }
  const finalIndex = () => S.fights.length - 1;

  async function pushState(next) {
    S.bstate = next; applyBracket(next, true);
    try { await api(`/api/rooms/${S.code}/state`, { method: 'POST', body: Object.assign({ host_token: hostToken(S.code) }, next) }); }
    catch (err) { toast(err.message); }
  }

  function applyBracket(state, local) {
    const st = { played: state.played || [], current: state.current === undefined ? -1 : state.current, skip: !!state.skip };
    if (!local && isHostHere() && S.playing >= 0) return; // the host's own fight is still running locally
    S.bstate = st;
    const res = S.room.results;
    const stageWrap = document.getElementById('stage-wrap');
    if (st.current >= 0 && S.playing !== st.current && !playedSet().has(st.current)) {
      S.selected = null;
      stageWrap.style.display = '';
      playBracketFight(st.current);
    } else if (st.current >= 0 && st.skip && S.playing === st.current && S.show && S.show.running) {
      S.show.skip();
    }
    if (st.current < 0 && S.playing >= 0 && playedSet().has(S.playing) && S.show && S.show.running) S.show.skip();
    if (S.playing < 0 && !st.played.length) stageWrap.style.display = 'none';
    const champion = playedSet().has(finalIndex());
    drawBracket(res);
    bracketControls();
    if (champion && !S.champShown && S.playing < 0) {
      S.champShown = true;
      stageWrap.style.display = '';
      const show = newShow(() => {});
      show.play(window.ArenaShow.celebrate(show, res.champion, 'CHAMPION'));
      ticker(`🏆 ${res.champion_name} is the champion!`);
      confetti(220);
      drawBracket(res);
    }
  }

  function playBracketFight(f) {
    const { m, ri } = S.fights[f];
    const round = S.room.results.rounds[ri].name;
    S.playing = f;
    S.fightLive = true;
    document.getElementById('stage-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const show = newShow(() => {
      S.fightLive = false;
      const loser = m.winner === m.a ? m.b : m.a;
      const pose = newShow(() => {});
      pose.play([{ dur: 3600000, draw: (ar) => [
        { f: ar.fighters[loser], x: ar.W * 0.62, y: ar.floorY, facing: -1, pose: { lie: 1, face: 'ko' } },
        { f: ar.fighters[m.winner], x: ar.W * 0.4, y: ar.floorY, facing: 1, pose: { raise: 1, face: 'win', bob: Math.sin(performance.now() / 200) * 3 } },
      ] }]);
      ticker(`🏆 ${nameOf(m.winner)} wins by ${METHOD[m.method]}${m.upset ? ' · UPSET!' : ''}`);
      if (window.Sfx) window.Sfx.play('crowd', 1);
      S.lastDone = f; S.playing = -1;
      const played = Array.from(new Set([...S.bstate.played, f]));
      if (isHostHere()) pushState({ played, current: -1, skip: false });
      else { S.bstate = { played, current: -1, skip: false }; drawBracket(S.room.results); bracketControls(); }
    });
    show.play(window.ArenaShow.duel(show, m, { intro: round.toUpperCase(), introTicker: `${round}: ${nameOf(m.a)} vs ${nameOf(m.b)}`, upset: m.upset }));
  }

  function bracketControls() {
    const anyPlayed = S.bstate.played.length > 0, live = S.playing >= 0;
    const remaining = S.fights.map((_, f) => f).filter((f) => !playedSet().has(f));
    if (!remaining.length && !live) { controls([]); return; }
    controls([
      ...(live ? [['skip-fight', 'Skip fight']] : []),
      ...(!anyPlayed && !live ? [['shuffle', 'Shuffle the draw 🔀']] : []),
      ...(remaining.length ? [['skip-round', 'Skip round']] : []),
    ]);
    on('skip-fight', () => pushState(Object.assign({}, S.bstate, { skip: true })));
    on('skip-round', () => {
      // finish every fight of the earliest unfinished round at once (results only, no animation)
      const ri = Math.min(...remaining.map((f) => S.fights[f].ri));
      const roundFights = remaining.filter((f) => S.fights[f].ri === ri);
      S.lastDone = roundFights[roundFights.length - 1];
      if (live && S.show) { S.playing = -1; S.fightLive = false; stopShow(); }
      pushState({ played: [...S.bstate.played, ...roundFights], current: -1, skip: false });
    });
    on('shuffle', async () => {
      try {
        S.room = await api(`/api/rooms/${S.code}/shuffle`, { method: 'POST', body: { host_token: hostToken(S.code) } });
        S.version = S.room.version; if (window.Sfx) window.Sfx.play('whoosh'); renderResults(); toast('New draw 🔀');
      } catch (err) { toast(err.message); }
    });
  }

  function fighterRow(id, known, cls, p) {
    if (!known) return '<div class="fr tbd"><span class="slot-q">?</span><span class="grow muted small">Waiting for winner</span></div>';
    return `<div class="fr ${cls}">${av(id, 26, cls === 'win' ? 'win' : cls === 'lose' ? 'ko' : 'normal')}<span class="grow nm">${esc(nameOf(id))}</span>${p !== null ? `<span class="pc">${pct(p)}</span>` : ''}</div>`;
  }

  function matchCard(ri, mi) {
    const res = S.room.results, m = res.rounds[ri].matches[mi];
    if (m.bye) {
      return `<div class="mcard bye">${fighterRow(m.winner, true, 'win', null)}<span class="bye-tag">BYE</span></div>`;
    }
    const f = S.fidx[`${ri}-${mi}`], done = playedSet().has(f), live = S.playing === f || S.bstate.current === f && !done;
    const ka = slotKnown(ri, mi, 0), kb = slotKnown(ri, mi, 1);
    const cls = (id) => (done ? (m.winner === id ? 'win' : 'lose') : '');
    const canPlay = isHostHere() && playable(f) && S.playing < 0 && !live;
    return `<div class="mcard ${done ? 'done' : ''} ${live ? 'live' : ''} ${ka && kb ? 'tap' : ''}" data-show="${ka && kb ? f : ''}">
      <div class="rows">${fighterRow(m.a, ka, cls(m.a), ka && kb ? m.p_a : null)}${fighterRow(m.b, kb, cls(m.b), ka && kb ? 1 - m.p_a : null)}</div>
      ${canPlay ? `<button class="play" data-play="${f}" aria-label="Start fight">▶</button>` : ''}
      ${live ? '<span class="live-badge">LIVE</span>' : ''}
      ${done ? `<span class="how">${METHOD[m.method]}${m.upset ? ' · upset' : ''}</span>` : ''}
    </div>`;
  }

  function drawBracket(res) {
    const first = res.rounds[0].matches.length;
    const cols = res.rounds.map((r, ri) => {
      const ms = r.matches.map((_, mi) => mi);
      const pairs = [];
      for (let k = 0; k < ms.length; k += 2) pairs.push(ms.slice(k, k + 2));
      return `<div class="bcol ${ri === res.rounds.length - 1 ? 'last' : ''} ${ri === 0 ? 'first' : ''}">
        <div class="bcol-title">${esc(r.name)}</div>
        <div class="bcol-body">${pairs.map((p) => `<div class="pair ${p.length === 2 ? 'two' : ''}">${p.map((mi) => `<div class="slot">${matchCard(ri, mi)}</div>`).join('')}</div>`).join('')}</div>
      </div>`;
    }).join('');
    const champ = playedSet().has(finalIndex()) && S.playing < 0;
    const T = champ ? titles(res) : null;
    document.getElementById('board').innerHTML = `
      ${champ ? `<div class="champ-band"><div class="label">🏆 Champion</div>${av(res.champion, 110, 'win')}<h1 style="margin:8px 0 6px">${esc(res.champion_name)}</h1><span class="title" style="font-size:15px">${esc(T[res.champion])}</span>
        <p class="muted small" style="margin-top:8px">${res.champion_path.map((s) => `beat ${esc(s.opponent)} (${METHOD[s.method]})`).join(' → ')}</p></div>` : ''}
      <div id="fightinfo"></div>
      <h2>The draw</h2>
      <p class="tiny muted">${isHostHere() ? 'Press ▶ to start a fight. Tap any match to see why the AI picks who it picks.' : 'Tap any match to see why the AI picks who it picks.'}</p>
      <div class="bracket-wrap"><div class="bracket2" style="--rows:${first}">${cols}</div></div>
      ${statsSection()}`;
    bindStats();
    document.querySelectorAll('[data-play]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation(); sound();
      pushState({ played: S.bstate.played, current: Number(b.dataset.play), skip: false });
    });
    document.querySelectorAll('.mcard[data-show]').forEach((c) => c.onclick = () => {
      if (c.dataset.show === '') return;
      S.selected = Number(c.dataset.show); drawFightInfo();
      document.getElementById('fightinfo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    drawFightInfo();
    if (champ) newRoundLink();
  }

  function drawFightInfo() {
    const el = document.getElementById('fightinfo');
    if (!el) return;
    const f = S.selected !== null ? S.selected : S.playing >= 0 ? S.playing : S.lastDone;
    if (f === null || f === undefined) { el.innerHTML = ''; return; }
    const { m, ri } = S.fights[f];
    const round = S.room.results.rounds[ri].name;
    const done = playedSet().has(f) && !(S.playing === f);
    if (!done) {
      el.innerHTML = `<h2>${S.playing === f ? 'Live now' : 'AI prediction'} · ${esc(round)}</h2>
        <div class="result-card" style="--c:${colorOf(m.p_a >= 0.5 ? m.a : m.b)}">${av(m.a, 48)}<div class="grow center"><div class="winner" style="color:var(--text)">${esc(nameOf(m.a))} <span class="muted">vs</span> ${esc(nameOf(m.b))}</div></div>${av(m.b, 48)}</div>
        ${predictionBody(m)}`;
      return;
    }
    const loser = m.winner === m.a ? m.b : m.a;
    el.innerHTML = `<h2>Result · ${esc(round)}</h2>
      <div class="result-card" style="--c:${colorOf(m.winner)}">${av(m.winner, 60, 'win')}
        <div class="grow"><div class="winner">${esc(nameOf(m.winner))} wins</div><div class="muted small">beat ${esc(nameOf(loser))} by ${METHOD[m.method]}${m.upset ? ' · UPSET 😱' : ''}</div></div>${av(loser, 42, 'ko')}</div>
      <h2>Why: the AI breakdown</h2>${fightBody(m)}`;
  }

  // ------------------------------------------------------------------ explanations
  function factors(list, aId, bId) {
    return list.map((f) => {
      const id = f.favors === 'a' ? aId : bId, alone = 50 + Math.abs(f.points_a);
      return `<div class="factor"><div class="top"><span>${esc(f.label)}</span><span class="num" style="color:${colorOf(id)}">${Math.round(alone)}% ${esc(nameOf(id))}</span></div>
        <div class="txt">${esc(f.text)}</div><div class="bar"><i style="width:${(alone - 50) * 2}%;background:${colorOf(id)}"></i></div></div>`;
    }).join('');
  }

  function predictionBody(m) {
    return `<div class="split"><i style="width:${m.p_a * 100}%;background:${colorOf(m.a)}"></i><i style="width:${(1 - m.p_a) * 100}%;background:${colorOf(m.b)}"></i></div>
      <div class="legend"><span>${esc(nameOf(m.a))} ${pct(m.p_a)}</span><span>${pct(1 - m.p_a)} ${esc(nameOf(m.b))}</span></div>
      ${tape(m.a, m.b)}
      <p style="margin-top:12px">${esc(m.explain.headline)}</p>
      <p class="tiny muted">Each factor alone: who would win, and how often, if everything else were equal.</p>
      ${factors(m.explain.factors.slice(0, 6), m.a, m.b)}`;
  }

  // ------------------------------------------------------------------ fighter stats (open at any point of the show)
  const SKILL_KEYS = ['striking', 'wrestling', 'grappling'];
  const skillSum = (p) => SKILL_KEYS.reduce((s, k) => s + p.levels[k], 0);
  const STAT_SORTS = [['weight', 'Weight', (p) => p.weight], ['height', 'Height', (p) => p.height],
    ['strength', 'Strength', (p) => p.strength_index], ['skill', 'Skill', skillSum], ['age', 'Age', (p) => p.age]];
  const round1 = (x) => (x === null || x === undefined ? '—' : String(Math.round(x * 10) / 10));
  const handOf = (p) => (p.hand === 'left' ? 'Left' : 'Right');

  // Side-by-side "tale of the tape" for one matchup; the bigger number in each row is highlighted.
  function tape(aId, bId) {
    const a = playerById(aId), b = playerById(bId);
    if (!a || !b) return '';
    const rows = [['Age', (p) => p.age, '', false], ['Height', (p) => p.height, ' cm', true], ['Weight', (p) => p.weight, ' kg', true],
      ['Reach', (p) => p.reach, ' cm', true], ['Hand', handOf, '', false],
      ...SKILL_KEYS.map((k) => [k[0].toUpperCase() + k.slice(1), (p) => p.levels[k], '/5', true]),
      ['Push-ups', (p) => p.pushups?.count ?? null, '', true], ['Strength', (p) => p.strength_index, ' kg', true]];
    const cell = (v, unit, up) => `<td class="${up ? 'up' : ''}">${typeof v === 'number' ? round1(v) + unit : esc(v ?? '—')}</td>`;
    return `<table class="tape"><tr><th style="color:${colorOf(aId)}">${esc(a.name)}</th><th></th><th style="color:${colorOf(bId)}">${esc(b.name)}</th></tr>
      ${rows.map(([k, get, unit, cmp]) => {
        const va = get(a), vb = get(b), num = cmp && typeof va === 'number' && typeof vb === 'number';
        return `<tr>${cell(va, unit, num && va > vb)}<td class="k">${k}</td>${cell(vb, unit, num && vb > va)}</tr>`;
      }).join('')}</table>`;
  }

  // Where each fighter stands right now, without spoiling anything the show has not revealed yet.
  function standing(id) {
    const res = S.room?.results;
    if (!res) return null;
    if (res.mode === 'ranking') {
      if (!S.drawn) return null;
      const row = res.table.find((r) => r.id === id);
      return row ? { text: `#${row.place}`, cls: row.place === 1 ? 'gold' : '' } : null;
    }
    if (!S.fights || !S.bstate) return null;
    const played = playedSet();
    if (played.has(finalIndex()) && S.playing < 0 && id === res.champion) return { text: 'Champion', cls: 'gold' };
    const lost = S.fights.find(({ m }, f) => played.has(f) && S.playing !== f && m.winner !== id && (m.a === id || m.b === id));
    if (lost) return { text: 'Out', cls: 'out' };
    return S.fights.some(({ m }, f) => S.playing === f && (m.a === id || m.b === id)) ? { text: 'Fighting', cls: 'live' } : { text: 'Still in', cls: 'in' };
  }

  function fighterCard(p, sortKey) {
    const st = standing(p.id);
    const stat = (key, label, value) => `<div class="${key === sortKey ? 'hi' : ''}"><span class="v">${value}</span><span class="k">${label}</span></div>`;
    const fit = p.fitness_class ? `Class ${esc(p.fitness_class)}` : '—';
    return `<div class="fcard" style="--c:${colorOf(p.id)}">
      <div class="fcard-head">${av(p.id, 44, st?.cls === 'gold' ? 'win' : st?.cls === 'out' ? 'ko' : 'normal')}
        <div class="grow"><b>${esc(p.name)}</b><span class="muted small">${esc(p.style)} · ${p.sex === 'F' ? 'Female' : 'Male'}</span></div>
        ${st ? `<span class="badge ${st.cls}">${esc(st.text)}</span>` : ''}</div>
      <div class="fstats">
        ${stat('age', 'Age', p.age)}${stat('height', 'Height', `${round1(p.height)} cm`)}${stat('weight', 'Weight', `${round1(p.weight)} kg`)}${stat('reach', 'Reach', `${Math.round(p.reach)} cm`)}
        ${stat('hand', 'Hand', handOf(p))}${stat('pushups', 'Push-ups', p.pushups ? p.pushups.count : '—')}${stat('fitness', 'Fitness', fit)}${stat('strength', 'Strength', `${Math.round(p.strength_index)} kg`)}
      </div>
      <div class="flevels ${sortKey === 'skill' ? 'hi' : ''}">${SKILLS.map(([k, t]) => `<div class="flevel"><span>${t}</span>
        <span class="pips" aria-label="${p.levels[k]} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= p.levels[k] ? 'on' : ''}"></i>`).join('')}</span>
        <span class="lv">${esc(LEVELS[p.levels[k]])}</span></div>`).join('')}</div>
    </div>`;
  }

  function statsBody() {
    const key = S.statSort || 'weight';
    const get = (STAT_SORTS.find((s) => s[0] === key) || STAT_SORTS[0])[2];
    const list = players().slice().sort((x, y) => get(y) - get(x) || x.name.localeCompare(y.name));
    return `<div class="seg sorter">${STAT_SORTS.map(([k, t]) => `<button type="button" data-sort="${k}" class="${k === key ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="list">${list.map((p) => fighterCard(p, key)).join('')}</div>
      <p class="tiny muted">Height, weight, age, hand, levels and push-ups are what each fighter entered. Reach, fitness class and strength
        (estimated powerlifting total) come from the AI models.</p>`;
  }

  function statsSection() {
    return `<details class="plain stats" id="stats" ${S.statsOpen ? 'open' : ''}><summary>📋 Fighter stats · ${players().length}</summary>
      <div id="stats-body">${statsBody()}</div></details>`;
  }

  function bindStats() {
    const el = document.getElementById('stats');
    if (!el) return;
    el.ontoggle = () => { S.statsOpen = el.open; };
    el.querySelectorAll('[data-sort]').forEach((b) => b.onclick = () => {
      S.statSort = b.dataset.sort;
      document.getElementById('stats-body').innerHTML = statsBody();
      bindStats();
    });
  }

  function fightBody(m) {
    return `<div class="split"><i style="width:${m.p_a * 100}%;background:${colorOf(m.a)}"></i><i style="width:${(1 - m.p_a) * 100}%;background:${colorOf(m.b)}"></i></div>
      <div class="legend"><span>${esc(nameOf(m.a))} ${pct(m.p_a)}</span><span>${pct(1 - m.p_a)} ${esc(nameOf(m.b))}</span></div>
      ${tape(m.a, m.b)}
      <p style="margin-top:12px">${esc(m.explain.headline)}</p>
      <p class="tiny muted">Each factor alone: who would win, and how often, if everything else were equal.</p>
      ${factors(m.explain.factors.slice(0, 6), m.a, m.b)}
      <p class="small muted" style="margin-top:10px">${esc(m.finish_reason)}</p>
      ${m.upset_note ? `<p class="small" style="color:var(--bad)">${esc(m.upset_note)}</p>` : ''}`;
  }

  // one fun title per player, from their stats and the result
  function titles(res) {
    const out = {}, list = players();
    const give = (id, t) => { if (id !== undefined && id !== null && !out[id]) out[id] = t; };
    const top = (key) => { const v = list.map(key); const max = Math.max(...v); return v.filter((x) => x === max).length === 1 && max > 0 ? list[v.indexOf(max)].id : null; };
    if (res.mode === 'ranking') { give(res.table[0].id, 'Final Boss 👑'); give(res.table[res.table.length - 1].id, 'NPC Energy 💀'); }
    else {
      give(res.champion, 'Champion 👑');
      const ups = res.rounds.flatMap((r) => r.matches).filter((m) => !m.bye && m.upset);
      if (ups.length) give(ups.sort((x, y) => Math.abs(0.5 - x.p_a) - Math.abs(0.5 - y.p_a)).pop().winner, 'Plot Armor 🛡️');
    }
    give(top((p) => p.strength_rel), 'Built Different 💪');
    give(top((p) => p.weight), 'Big Unit 🐻');
    give(top((p) => p.levels.striking), 'Hands of Stone 🥊');
    give(top((p) => p.levels.grappling), 'Human Anaconda 🐍');
    give(top((p) => p.levels.wrestling), 'Takedown Machine 🚜');
    give(top((p) => p.reach), 'Go-Go Gadget Arms 📏');
    give(top((p) => -p.age), 'Young Gun ⚡');
    give(top((p) => p.age), 'Old Man Strength 🧓');
    const fallback = ['Main Character', 'Sparring Partner', 'Comic Relief 🤡', 'Side Quest', 'Certified Brawler', 'Glass Cannon 🥂', 'Snack Enjoyer 🍿'];
    list.forEach((p, i) => give(p.id, fallback[(p.id + i) % fallback.length]));
    return out;
  }

  function newRoundLink() {
    if (!hostToken(S.code)) return;
    const p = document.createElement('p'); p.className = 'center'; p.style.marginTop = '32px';
    p.innerHTML = '<button class="link" id="again">New round</button>';
    document.getElementById('board').appendChild(p);
    document.getElementById('again').onclick = async () => {
      try { S.room = await api(`/api/rooms/${S.code}/reset`, { method: 'POST', body: { host_token: hostToken(S.code) } }); S.version = S.room.version; stopShow(); S.view = null; renderLobby(); }
      catch (err) { toast(err.message); }
    };
  }

  function drawRanking(res) {
    const T = titles(res);
    const rows = res.table.map((r) => {
      const max = Math.max(5, ...r.reasons.map((x) => Math.abs(x.points)));
      const reasons = r.reasons.map((x) => `<div class="factor"><div class="top"><span>${esc(x.label)}</span><span class="num" style="color:${x.points > 0 ? 'var(--good)' : 'var(--bad)'}">${x.points > 0 ? '+' : '−'}${Math.abs(x.points).toFixed(0)}%</span></div>
        <div class="txt">${esc(x.text)}</div><div class="bar"><i style="width:${(Math.abs(x.points) / max) * 100}%;background:${x.points > 0 ? 'var(--good)' : 'var(--bad)'}"></i></div></div>`).join('');
      const top = r.place <= res.top_k;
      const mood = r.place === 1 ? 'win' : r.place === res.table.length ? 'sad' : 'normal';
      return `<details class="row" style="--c:${colorOf(r.id)}" ${r.place === 1 ? 'open' : ''}><summary><span class="place">${r.place}</span>${av(r.id, 40, mood)}<span class="grow"><b>${esc(r.name)}</b><br><span class="title">${esc(T[r.id] || '')}</span></span><span class="num">${pct(r.win_rate)}</span></summary>
        <div class="body"><p class="small">${esc(r.why)}</p>
          <p class="tiny muted">Each factor alone: average edge over a 50/50 fight against the group.</p>${reasons}
          <p class="small muted" style="margin-top:8px">Best: ${pct(r.easiest.p)} vs ${esc(r.easiest.name)} · Toughest: ${pct(r.hardest.p)} vs ${esc(r.hardest.name)}</p></div></details>`;
    });
    const top = rows.slice(0, res.top_k).join(''), rest = rows.slice(res.top_k).join('');
    const ids = res.matrix.ids;
    const champ = res.table[0];
    document.getElementById('board').innerHTML = `
      <div class="champ-band"><div class="label">🏆 Number one</div>${av(champ.id, 120, 'win')}<h1 style="margin:8px 0 6px">${esc(champ.name)}</h1><span class="title" style="font-size:15px">${esc(T[champ.id])}</span></div>
      <h2>Top ${res.top_k}</h2><p class="tiny muted">Expected win rate against everyone else. Tap a name for why.</p>
      <div class="list">${top}</div>
      ${rest ? `<details class="plain"><summary>Everyone else</summary><div class="list">${rest}</div></details>` : ''}
      <details class="plain"><summary>Who beats whom</summary><div class="scroll"><table class="mx"><tr><th></th>${ids.map((id) => `<th>${esc(nameOf(id).slice(0, 6))}</th>`).join('')}</tr>
        ${ids.map((rid, i) => `<tr><th style="text-align:right">${esc(nameOf(rid))}</th>${res.matrix.p[i].map((p) => (p === null ? '<td class="muted">·</td>' : `<td style="background:${p >= 0.5 ? `rgba(34,197,94,${0.15 + (p - 0.5) * 1.2})` : `rgba(244,63,94,${0.15 + (0.5 - p) * 1.2})`};font-weight:700">${Math.round(p * 100)}</td>`)).join('')}</tr>`).join('')}</table></div>
        <p class="tiny muted">Chance that the row player beats the column player.</p></details>
      ${res.show.final ? `<details class="plain"><summary>The final: ${esc(nameOf(res.show.final.a))} vs ${esc(nameOf(res.show.final.b))}</summary>${fightBody(res.show.final)}</details>` : ''}
      ${statsSection()}`;
    bindStats();
    newRoundLink();
  }

  route();
})();
