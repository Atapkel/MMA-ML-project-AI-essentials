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
    const room = await api(`/api/rooms/${S.code}`);
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
    if (room.status === 'done') { if (S.view !== 'results' || S.resultsVersion !== room.version) renderResults(); return; }
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
        S.room = room; S.version = S.room.version; renderResults();
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

  // ------------------------------------------------------------------ results
  function renderResults() {
    stopShow();
    S.view = 'results'; S.resultsVersion = S.room.version;
    const res = S.room.results;
    const seenKey = `arena:seen:${S.code}:${S.room.version}`;
    app.innerHTML = `<div class="stage"><canvas id="stage" aria-label="Fight animation. Tap to skip."></canvas></div>
      <div class="ticker" id="ticker"></div>
      <div class="reacts" id="reacts">${['🔥', '😂', '💀', '👏', '😱'].map((e) => `<button aria-label="React ${e}">${e}</button>`).join('')}</div>
      <div id="board"></div>`;
    document.querySelectorAll('#reacts button').forEach((b) => b.onclick = () => {
      const r = b.getBoundingClientRect();
      for (let k = 0; k < 3; k++) setTimeout(() => floaty(r.left + r.width / 2, r.top, b.textContent), k * 120);
      if (window.Sfx) window.Sfx.play('boing');
    });
    const ticker = (t) => { const el = document.getElementById('ticker'); if (el) el.textContent = t; };
    const finish = () => {
      store.set(seenKey, true);
      ticker('');
      if (res.mode === 'ranking') drawRanking(res); else drawTournament(res);
      confetti(180);
    };
    const roster = players().map((p) => ({ id: p.id, name: p.name, sex: p.sex, color: colorOf(p.id), height: p.height, weight: p.weight }));
    const canvas = document.getElementById('stage');
    const play = () => {
      stopShow();
      document.getElementById('board').innerHTML = '';
      S.show = window.ArenaShow.create(canvas, roster, { onTicker: ticker, onDone: finish });
      if (res.mode === 'ranking') {
        const onStage = new Set(res.table.map((r) => r.id).slice(0, 12));
        const ids = players().map((p) => p.id).filter((id) => onStage.has(id));
        const show = Object.assign({}, res.show, { eliminations: res.show.eliminations.filter((e) => onStage.has(e.victim)) });
        S.show.play(window.ArenaShow.brawl(S.show, ids, show, {}));
      } else {
        const segs = [];
        res.rounds.forEach((r) => r.matches.filter((m) => !m.bye).forEach((m) => {
          segs.push(...window.ArenaShow.duel(S.show, m, { intro: r.name.toUpperCase(), introTicker: `${r.name}: ${nameOf(m.a)} vs ${nameOf(m.b)}`, upset: m.upset }));
        }));
        segs.push(...window.ArenaShow.celebrate(S.show, res.champion, 'CHAMPION'));
        S.show.play(segs);
      }
    };
    canvas.onclick = () => { if (S.show && S.show.running) S.show.skip(); else play(); };
    if (store.get(seenKey)) { finish(); ticker('Tap the stage to replay.'); } else { ticker('Tap the stage to skip.'); play(); }
  }

  // ------------------------------------------------------------------ explanations
  function factors(list, aId, bId) {
    return list.map((f) => {
      const id = f.favors === 'a' ? aId : bId, alone = 50 + Math.abs(f.points_a);
      return `<div class="factor"><div class="top"><span>${esc(f.label)}</span><span class="num" style="color:${colorOf(id)}">${Math.round(alone)}% ${esc(nameOf(id))}</span></div>
        <div class="txt">${esc(f.text)}</div><div class="bar"><i style="width:${(alone - 50) * 2}%;background:${colorOf(id)}"></i></div></div>`;
    }).join('');
  }

  function fightBody(m) {
    return `<div class="split"><i style="width:${m.p_a * 100}%;background:${colorOf(m.a)}"></i><i style="width:${(1 - m.p_a) * 100}%;background:${colorOf(m.b)}"></i></div>
      <div class="legend"><span>${esc(nameOf(m.a))} ${pct(m.p_a)}</span><span>${pct(1 - m.p_a)} ${esc(nameOf(m.b))}</span></div>
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
      ${res.show.final ? `<details class="plain"><summary>The final: ${esc(nameOf(res.show.final.a))} vs ${esc(nameOf(res.show.final.b))}</summary>${fightBody(res.show.final)}</details>` : ''}`;
    newRoundLink();
  }

  function drawTournament(res) {
    const T = titles(res);
    const rounds = res.rounds.map((r) => {
      const fights = r.matches.filter((m) => !m.bye).map((m) => {
        const loser = m.winner === m.a ? m.b : m.a;
        const pw = m.winner === m.a ? m.p_a : 1 - m.p_a;
        return `<details class="row" style="--c:${colorOf(m.winner)}"><summary>${av(m.winner, 36, 'win')}${av(loser, 28, 'ko')}<span class="grow"><b>${esc(nameOf(m.winner))}</b> <span class="muted">beat ${esc(nameOf(loser))} · ${METHOD[m.method]}${m.upset ? ' · upset' : ''}</span></span><span class="num muted">${pct(pw)}</span></summary>
          <div class="body">${fightBody(m)}</div></details>`;
      }).join('');
      const byes = r.matches.filter((m) => m.bye).map((m) => nameOf(m.winner));
      return `<h2>${esc(r.name)}</h2><div class="list">${fights}</div>${byes.length ? `<p class="tiny muted" style="margin-top:8px">Bye: ${byes.map(esc).join(', ')}</p>` : ''}`;
    }).join('');
    document.getElementById('board').innerHTML = `
      <div class="champ-band"><div class="label">🏆 Champion</div>${av(res.champion, 120, 'win')}<h1 style="margin:8px 0 6px">${esc(res.champion_name)}</h1><span class="title" style="font-size:15px">${esc(T[res.champion])}</span>
        <p class="muted small">${res.champion_path.map((s) => `beat ${esc(s.opponent)} (${METHOD[s.method]})`).join(' → ')}</p></div>
      <div class="list" style="margin-top:16px">${players().filter((p) => p.id !== res.champion).map((p) => `<div class="item" style="--c:${colorOf(p.id)}">${av(p.id, 34)}<span class="grow">${esc(p.name)}</span><span class="title">${esc(T[p.id] || '')}</span></div>`).join('')}</div>
      <p class="tiny muted">Tap a fight for why. The % is the winner's chance before the fight.</p>
      ${rounds}`;
    newRoundLink();
  }

  route();
})();
