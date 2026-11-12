/* Fight Arena show renderer (canvas): bobblehead fighters, duel scripts from the engine,
 * a battle royale for ranking mode, meme captions, emoji bursts, slow motion and sound. */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  const easeOut = (u) => 1 - Math.pow(1 - u, 3);
  const pick = (arr, r) => arr[Math.floor((r === undefined ? Math.random() : r) * arr.length) % arr.length];
  let SILENT = false; // true while fast-forwarding: keep bookkeeping, skip sounds and effects
  const sfx = (name, k) => { if (window.Sfx && !SILENT) window.Sfx.play(name, k); };

  const MEMES = {
    KO: ['EMOTIONAL DAMAGE', 'SENT TO THE SHADOW REALM', 'SKILL ISSUE 💀', "HE'S SLEEPING 😴", 'NOT LIKE THIS...', 'BONK 🔨',
      '-1000 AURA', 'WINDOWS SHUTDOWN NOISE', 'RIP BOZO 🪦', 'CALL AN AMBULANCE... NOT FOR ME', 'TOUCHED GRASS (FACE FIRST)'],
    SUB: ['TAP TAP TAP 👋', 'PRETZEL MODE 🥨', 'BRO BECAME A BACKPACK 🎒', 'HUG OF DEATH 🫂', 'NAP TIME 😴', 'UNO REVERSE CARD 🔄'],
    DEC: ['WON ON AURA ✨', 'JUDGES SAID: VIBES', 'CARDIO KING 🫀', 'BORING BUT EFFECTIVE', 'POINTS DON\'T LIE 📋'],
    UPSET: ['PLOT TWIST 😱', 'NOBODY EXPECTED THAT', 'UNDERDOG ARC 📈', 'THE AUDACITY 😤'],
    HIT: ['BONK!', 'POW!', 'OOF', 'WHAM!', 'CRITICAL HIT', '+50 AURA', 'OUCH 💥', 'SHEESH'],
    WIN: ['GOAT 🐐', 'MAIN CHARACTER ENERGY', 'CHAMPION ARC 👑', 'TOO EASY 😎', 'FINAL BOSS DEFEATED'],
    OUT: ['GET OUT 🚪', 'BYE BYE 👋', 'SEE YOU NEVER', 'UNINSTALLED'],
  };
  const SKINS = ['#f6d2b0', '#e8b48a', '#c98e62', '#9a6643', '#6e4630', '#f3c6a5'];
  const VERB = {
    jab: ['snaps a jab', 'jab gets slipped'], cross: ['lands a BIG cross!', 'cross whiffs'],
    kick: ['lands a heavy kick!', 'kick gets checked'], takedown: ['scores a takedown!', 'takedown gets stuffed'],
    ground_strike: ['rains ground-and-pound', 'ground strikes get blocked'],
    sub_attempt: ['hunts for a submission', 'submission attempt escaped'], stand_up: ['gets back up', 'gets back up'],
  };

  // ------------------------------------------------------------------ runner
  function Arena(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.fighters = {};
    this.segments = [];
    this.parts = [];
    this.overlays = [];
    this.speed = 1;
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  Arena.prototype.resize = function () {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(280, r.width);
    this.H = Math.max(220, r.height);
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.unit = clamp(this.H / 380, 0.6, 1.4);
    this.floorY = this.H * 0.84;
    if (this.layout) this.layout();
  };

  Arena.prototype.addFighter = function (id, info, index) {
    const skin = SKINS[(Number(id) * 7 + (info.name || '').length) % SKINS.length];
    const f = { id, name: info.name, color: info.color, height: info.height || 178, weight: info.weight || 78, skin, index };
    // the player's own cartoon avatar becomes the fighter's head, one image per mood
    if (window.Avatar) {
      const seed = window.Avatar.seed(id, info.name);
      f.skin = window.Avatar.skin(seed, info.sex);  // body matches the avatar's face
      f.heads = {};
      for (const mood of ['normal', 'hit', 'ko', 'win', 'sad']) f.heads[mood] = window.Avatar.img(seed, { color: info.color, sex: info.sex, mood, bg: false });
    }
    this.fighters[id] = f;
  };

  Arena.prototype.play = function (segments) {
    this.segments = segments;
    this.total = segments.reduce((s, x) => s + x.dur, 0);
    this.elapsed = 0;
    this.current = -1;
    this.running = true;
    this.prev = performance.now();
    requestAnimationFrame(this.frame);
  };
  Arena.prototype.setSpeed = function (s) { this.speed = s; };
  Arena.prototype.skip = function () { this.skipped = true; this.elapsed = this.total; };
  // jump to the first segment marked `mark` (e.g. 'final'), quietly running the bookkeeping on the way
  Arena.prototype.skipTo = function (mark) {
    const idx = this.segments.findIndex((sg) => sg.mark === mark);
    if (idx < 0 || idx <= this.current) return;
    SILENT = true;
    try { for (let k = this.current + 1; k < idx; k++) if (this.segments[k].start) this.segments[k].start(this); }
    finally { SILENT = false; }
    this.current = idx - 1;
    this.elapsed = this.segments.slice(0, idx).reduce((sum, sg) => sum + sg.dur, 0);
    this.overlays = []; this.parts = [];
  };
  Arena.prototype.destroy = function () { this.running = false; window.removeEventListener('resize', this.resize); };

  Arena.prototype.frame = function (now) {
    if (!this.running) return;
    if (this.skipped) {
      this.running = false;
      window.removeEventListener('resize', this.resize);
      if (this.opts.onDone) this.opts.onDone();
      return;
    }
    const dt = Math.min(80, now - this.prev);
    this.prev = now;
    // locate segment
    let t = this.elapsed, i = 0;
    while (i < this.segments.length - 1 && t >= this.segments[i].dur) { t -= this.segments[i].dur; i++; }
    const seg = this.segments[i];
    const u = clamp(t / seg.dur, 0, 1);
    const slow = seg.slow ? seg.slow(u) : 1;
    this.elapsed += dt * this.speed * slow;
    // run every start() we passed, so instant bookkeeping segments are never skipped by a long frame
    while (this.current < i) {
      this.current += 1;
      const s = this.segments[this.current];
      if (s.start) s.start(this);
    }
    this.render(seg, u, dt);
    if (this.elapsed >= this.total) {
      this.running = false;
      window.removeEventListener('resize', this.resize);
      if (this.opts.onDone) this.opts.onDone();
      return;
    }
    requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------------ effects
  Arena.prototype.ticker = function (text) { if (this.opts.onTicker && !SILENT) this.opts.onTicker(text); };
  Arena.prototype.meme = function (text, opts) {
    if (SILENT) return;
    this.overlays.push(Object.assign({ text, born: performance.now(), life: 1900, kind: 'meme', tilt: (Math.random() - 0.5) * 0.16 }, opts || {}));
  };
  Arena.prototype.stamp = function (text, color, life) {
    if (SILENT) return;
    this.overlays.push({ text, color: color || '#fff', born: performance.now(), life: life || 1400, kind: 'stamp' });
  };
  Arena.prototype.pop = function (text, x, y, color) {
    if (SILENT) return;
    this.overlays.push({ text, x, y, color: color || '#ffd23f', born: performance.now(), life: 900, kind: 'pop', tilt: (Math.random() - 0.5) * 0.4 });
  };
  Arena.prototype.burst = function (x, y, emojis, n, power) {
    if (SILENT) return;
    for (let k = 0; k < (n || 10); k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, v = (2 + Math.random() * 5) * (power || 1);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, emoji: pick(emojis), rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3, size: 16 + Math.random() * 14 });
    }
  };
  Arena.prototype.sparks = function (x, y, n) {
    if (SILENT) return;
    for (let k = 0; k < (n || 16); k++) {
      const a = Math.random() * TAU, v = 2 + Math.random() * 5;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 1, spark: true });
    }
  };
  Arena.prototype.confetti = function (n) {
    if (SILENT) return;
    const colors = ['#ff3d8b', '#ffd23f', '#2de2e6', '#a3e635', '#8b5cf6', '#ff8a3d'];
    for (let k = 0; k < (n || 120); k++) {
      this.parts.push({ x: Math.random() * this.W, y: -20 - Math.random() * this.H * 0.5, vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 2.5, life: 3, confetti: pick(colors), rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3, size: 5 + Math.random() * 6 });
    }
  };
  Arena.prototype.shake = function (power) {
    if (SILENT) return; this.shakeUntil = performance.now() + 260; this.shakePower = power || 6; };
  Arena.prototype.flash = function () {
    if (SILENT) return; this.flashUntil = performance.now() + 120; };

  // ------------------------------------------------------------------ frame render
  Arena.prototype.render = function (seg, u) {
    const ctx = this.ctx, W = this.W, H = this.H, now = performance.now();
    ctx.save();
    if (this.shakeUntil > now) ctx.translate((Math.random() - 0.5) * this.shakePower, (Math.random() - 0.5) * this.shakePower);
    const zoom = seg.zoom ? seg.zoom(u) : null;
    this.drawBackground(now);
    if (zoom) {
      ctx.save();
      ctx.translate(zoom.x, zoom.y); ctx.scale(zoom.k, zoom.k); ctx.translate(-zoom.x, -zoom.y);
    }
    const sprites = seg.draw(this, u) || [];
    sprites.sort((p, q) => (p.y - q.y) || ((p.pose.lie || 0) - (q.pose.lie || 0)) * -1);
    for (const s of sprites) this.drawFighter(s);
    this.drawParticles();
    if (zoom) ctx.restore();
    if (seg.hud) seg.hud(this, u);
    this.drawOverlays(now);
    if (this.flashUntil > now) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  };

  Arena.prototype.drawBackground = function (now) {
    // fight-night arena: dark hall, spotlights, cage fence, octagon mat with red and blue corners
    const ctx = this.ctx, W = this.W, H = this.H, fy = this.floorY, t = (now || performance.now()) / 1000;
    ctx.fillStyle = '#09090a'; ctx.fillRect(-20, -20, W + 40, H + 40);
    // crowd in the dark, lit by phone flashes
    for (let r = 0; r < 3; r++) {
      const y = H * 0.34 + r * 14 * this.unit, size = (8 + r * 2) * this.unit;
      ctx.fillStyle = ['#151517', '#1a1a1d', '#202024'][r];
      for (let x = (r % 2) * 9; x < W + 20; x += size * 2.15) {
        const bob = Math.sin(t * 7 + x * 0.3 + r) * 2.2 * (this.hype || 0.4);
        ctx.beginPath(); ctx.arc(x, y + bob, size, 0, TAU); ctx.fill();
        ctx.fillRect(x - size, y + bob, size * 2, size * 2.2);
      }
    }
    for (let k = 0; k < 6; k++) {
      if (Math.sin(t * 2.7 + k * 13.1) > 0.94) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc((k * 173 + 40) % W, H * 0.36 + (k % 3) * 14, 2.2, 0, TAU); ctx.fill(); }
    }
    // spotlight cone onto the octagon
    const cone = ctx.createLinearGradient(0, 0, 0, fy);
    cone.addColorStop(0, 'rgba(255,255,255,.16)'); cone.addColorStop(1, 'rgba(255,255,255,.03)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(W * 0.42, -10); ctx.lineTo(W * 0.58, -10); ctx.lineTo(W * 0.92, fy + 10); ctx.lineTo(W * 0.08, fy + 10); ctx.closePath(); ctx.fill();
    // octagon mat
    const oct = (rx, ry) => { ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + Math.PI / 8; const x = W / 2 + Math.cos(a) * rx, y = fy + 8 + Math.sin(a) * ry; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath(); };
    oct(W * 0.48, 30 * this.unit); ctx.fillStyle = '#d9d9dc'; ctx.fill();
    oct(W * 0.48, 30 * this.unit); ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
    oct(W * 0.2, 12 * this.unit); ctx.fillStyle = 'rgba(210,10,10,.15)'; ctx.fill();
    // corner pads
    ctx.fillStyle = '#d20a0a'; ctx.fillRect(W * 0.04, fy - 70 * this.unit, 7, 80 * this.unit);
    ctx.fillStyle = '#1d4ed8'; ctx.fillRect(W * 0.96 - 7, fy - 70 * this.unit, 7, 80 * this.unit);
    // chain-link fence along the back
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
    const top = H * 0.24, step = 12 * this.unit;
    for (let x = -H; x < W + H; x += step) {
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + (fy - top), fy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x - (fy - top), fy); ctx.stroke();
    }
    ctx.fillStyle = '#2a2a2e'; ctx.fillRect(0, top - 3, W, 3);
  };

  Arena.prototype.drawParticles = function () {
    const ctx = this.ctx;
    this.parts = this.parts.filter((p) => p.life > 0 && p.y < this.H + 60);
    for (const p of this.parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.confetti) { p.vx += (Math.random() - 0.5) * 0.1; p.life -= 0.004; } else { p.vy += 0.18; p.life -= p.spark ? 0.045 : 0.014; }
      if (p.rot !== undefined) p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.translate(p.x, p.y);
      if (p.spark) { ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(0, 0, 2.6 * this.unit, 0, TAU); ctx.fill(); }
      else if (p.confetti) { ctx.rotate(p.rot); ctx.fillStyle = p.confetti; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
      else { ctx.rotate(p.rot); ctx.font = `${p.size * this.unit}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.emoji, 0, 0); }
      ctx.restore();
    }
  };

  Arena.prototype.drawOverlays = function (now) {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.overlays = this.overlays.filter((o) => now - o.born < o.life);
    for (const o of this.overlays) {
      const age = (now - o.born) / o.life;
      const pop = easeOut(clamp(age * 6, 0, 1));
      const alpha = age > 0.82 ? (1 - age) / 0.18 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (o.kind === 'stamp') {
        ctx.translate(W / 2, H * 0.3);
        ctx.scale(0.4 + 0.6 * pop, 0.4 + 0.6 * pop);
        const size = Math.min(76, W / 7.5);
        ctx.font = `700 ${size}px Oswald, Impact, sans-serif`;
        const grad = ctx.createLinearGradient(-W / 3, 0, W / 3, 0);
        grad.addColorStop(0, '#f5d76e'); grad.addColorStop(0.5, '#d4af37'); grad.addColorStop(1, '#f5d76e');
        ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'; ctx.strokeText(o.text, 0, 0);
        ctx.fillStyle = grad; ctx.fillText(o.text, 0, 0);
      } else if (o.kind === 'meme') {
        ctx.translate(W / 2, o.bottom ? H * 0.62 : H * 0.17);
        ctx.rotate(o.tilt);
        ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
        let size = Math.min(54, W / 11);
        ctx.font = `${size}px Anton, Impact, sans-serif`;
        while (ctx.measureText(o.text).width > W * 0.92 && size > 16) { size -= 2; ctx.font = `${size}px Anton, Impact, sans-serif`; }
        ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'; ctx.strokeText(o.text, 0, 0);
        ctx.fillStyle = '#fff'; ctx.fillText(o.text, 0, 0);
      } else if (o.kind === 'pop') {
        ctx.translate(o.x, o.y - age * 40);
        ctx.rotate(o.tilt);
        ctx.scale(0.5 + 0.7 * pop, 0.5 + 0.7 * pop);
        ctx.font = `800 ${22 * this.unit}px system-ui, sans-serif`;
        ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(o.text, 0, 0);
        ctx.fillStyle = o.color; ctx.fillText(o.text, 0, 0);
      }
      ctx.restore();
    }
  };

  // ------------------------------------------------------------------ the fighter
  function basePose() {
    return { armF: 0, armB: 0, kick: 0, lean: 0, lie: 0, crouch: 0, flash: 0, guard: 1, raise: 0, knock: 0, face: 'normal', spin: 0, alpha: 1, bob: 0, tap: 0, scale: 1 };
  }

  Arena.prototype.drawFighter = function (sprite) {
    const { f, x, y, facing } = sprite;
    const pose = Object.assign(basePose(), sprite.pose);
    const ctx = this.ctx;
    const s = this.unit * pose.scale * clamp(f.height / 178, 0.85, 1.15);
    const bw = Math.sqrt(clamp(f.weight / 75, 0.65, 1.9));
    const legL = 36 * s, torsoL = 34 * s, upper = 19 * s, fore = 17 * s, headR = 25 * s;
    const face = facing;
    ctx.save();
    ctx.globalAlpha = pose.alpha;
    ctx.translate(x - face * pose.knock, y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(0, 4, (20 + 8 * bw) * s * (pose.lie ? 1.8 : 1), 6 * s, 0, 0, TAU); ctx.fill();
    if (pose.lie) { ctx.rotate(-face * pose.lie * Math.PI / 2); ctx.translate(0, -pose.lie * 10 * s); }
    if (pose.spin) ctx.rotate(pose.spin);
    const hipY = -legL * (1 - 0.5 * pose.crouch) + pose.bob;
    const shX = face * (5 + 14 * pose.lean) * s, shY = hipY - torsoL * (1 - 0.2 * pose.lean);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // legs
    ctx.strokeStyle = f.skin; ctx.lineWidth = 10 * bw * s;
    const footF = { x: face * (13 + 22 * pose.crouch) * s, y: 0 }, footB = { x: -face * 12 * s, y: 0 };
    if (pose.kick) { footF.x = lerp(footF.x, face * legL * 1.05, pose.kick); footF.y = lerp(0, hipY - 4 * s, pose.kick); }
    for (const foot of [footB, footF]) {
      const kx = foot.x / 2 + face * (5 + 10 * pose.crouch) * s, ky = (hipY + foot.y) / 2;
      ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(kx, ky); ctx.lineTo(foot.x, foot.y); ctx.stroke();
      ctx.fillStyle = '#1b1238'; ctx.beginPath(); ctx.ellipse(foot.x + face * 3 * s, foot.y - 1, 7 * s, 4 * s, 0, 0, TAU); ctx.fill();
    }
    // shorts
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-13 * bw * s, hipY - 8 * s, 26 * bw * s, 16 * s, 5 * s) : ctx.rect(-13 * bw * s, hipY - 8 * s, 26 * bw * s, 16 * s); ctx.fill();
    // torso
    ctx.strokeStyle = pose.flash > 0 ? '#ffffff' : f.skin; ctx.lineWidth = 20 * bw * s;
    ctx.beginPath(); ctx.moveTo(0, hipY - 4 * s); ctx.lineTo(shX, shY); ctx.stroke();
    // rear arm behind head, front arm after
    const arm = (ext, rear) => {
      const sx = shX - face * (rear ? 6 : -3) * s, sy = shY + 4 * s;
      let hx, hy;
      if (pose.raise) {
        hx = sx + face * (rear ? -10 : 10) * s * pose.raise + face * 8 * s * (1 - pose.raise);
        hy = lerp(sy - 14 * s, sy - (upper + fore) * 1.05, pose.raise);
      } else if (pose.tap) {
        hx = sx + face * 22 * s; hy = sy + 10 * s + Math.sin(performance.now() / 60) * 6 * s * pose.tap;
      } else {
        const gx = sx + face * (16 + 4 * pose.guard) * s, gy = sy - (12 + 6 * (pose.guard - 1)) * s;
        hx = lerp(gx, sx + face * (upper + fore), ext); hy = lerp(gy, sy - 4 * s + (pose.crouch > 0.5 ? 18 * s * ext : 0), ext);
      }
      const ex = (sx + hx) / 2 - face * 3 * s * (1 - ext), ey = (sy + hy) / 2 + 8 * s * (1 - ext);
      ctx.strokeStyle = f.skin; ctx.lineWidth = 8 * bw * s;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = f.color; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(hx, hy, 9 * s, 0, TAU); ctx.fill(); ctx.stroke();
    };
    arm(pose.armB, true);
    // head (the bobble)
    const hx = shX + face * 3 * s, hy = shY - headR * 0.85 + Math.sin(performance.now() / 140 + f.index) * 1.5 * s;
    const mood = { tap: 'sad' }[pose.face] || pose.face || 'normal';
    const headImg = f.heads && f.heads[mood];
    if (headImg && headImg.complete && headImg.naturalWidth) {
      const size = headR * 2.5;
      ctx.save();
      ctx.translate(hx, hy);
      if (face < 0) ctx.scale(-1, 1);
      if (pose.flash > 0) ctx.filter = 'brightness(1.8)';
      ctx.drawImage(headImg, -size / 2, -size / 2 - 2 * s, size, size);
      ctx.restore();
      if (pose.face === 'ko') {
        ctx.font = `${13 * s}px sans-serif`; ctx.textAlign = 'center';
        const tt = performance.now() / 280;
        for (let k = 0; k < 3; k++) ctx.fillText('⭐', hx + Math.cos(tt + k * 2.1) * 26 * s, hy - headR - 6 * s + Math.sin(tt + k * 2.1) * 6 * s);
      }
      arm(pose.armF, false);
      ctx.restore();
      this.drawTag(sprite, pose, s, legL, torsoL, headR);
      return;
    }
    ctx.fillStyle = pose.flash > 0 ? '#ffffff' : f.skin;
    ctx.beginPath(); ctx.arc(hx, hy, headR, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2 * s; ctx.stroke();
    // hair + headband in fighter colour
    ctx.fillStyle = '#21123f';
    ctx.beginPath(); ctx.arc(hx - face * 2 * s, hy - 4 * s, headR * 1.02, Math.PI * 1.08, Math.PI * 1.92); ctx.fill();
    ctx.fillStyle = f.color;
    ctx.fillRect(hx - headR, hy - headR * 0.42, headR * 2, 6 * s);
    ctx.beginPath(); ctx.moveTo(hx - face * headR * 0.95, hy - headR * 0.35);
    ctx.lineTo(hx - face * (headR + 14 * s), hy - headR * 0.1 + Math.sin(performance.now() / 120) * 3 * s);
    ctx.lineTo(hx - face * (headR + 10 * s), hy - headR * 0.5); ctx.fill();
    this.drawFace(hx, hy, headR, face, pose.face, s);
    if (pose.face === 'ko') {
      ctx.font = `${13 * s}px sans-serif`; ctx.textAlign = 'center';
      const tt = performance.now() / 280;
      for (let k = 0; k < 3; k++) ctx.fillText('⭐', hx + Math.cos(tt + k * 2.1) * 26 * s, hy - headR - 6 * s + Math.sin(tt + k * 2.1) * 6 * s);
    }
    arm(pose.armF, false);
    ctx.restore();
    this.drawTag(sprite, pose, s, legL, torsoL, headR);
  };

  Arena.prototype.drawTag = function (sprite, pose, s, legL, torsoL, headR) {
    const ctx = this.ctx, { f, x, y } = sprite;
    if (!sprite.noTag && pose.alpha > 0.3) {
      ctx.save();
      ctx.globalAlpha = pose.alpha;
      ctx.font = `600 ${12 * this.unit * Math.max(0.75, pose.scale)}px Oswald, system-ui, sans-serif`; ctx.textAlign = 'center';
      const label = f.name.length > 12 ? f.name.slice(0, 11) + '…' : f.name;
      const tw = ctx.measureText(label).width + 14;
      const ty = pose.lie > 0.5 ? y - 30 * s : y - legL - torsoL - headR * 2.1 - 8 * s;
      ctx.fillStyle = f.color; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - tw / 2, ty - 10 * this.unit, tw, 18 * this.unit, 9 * this.unit); else ctx.rect(x - tw / 2, ty - 10 * this.unit, tw, 18 * this.unit);
      ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText(label, x, ty + 3 * this.unit);
      ctx.restore();
    }
  };

  Arena.prototype.drawFace = function (hx, hy, r, face, mood, s) {
    const ctx = this.ctx;
    const ex = hx + face * 6 * s, ey = hy + 2 * s, gap = 9 * s;
    ctx.strokeStyle = '#1b1238'; ctx.fillStyle = '#1b1238'; ctx.lineWidth = 2.5 * s;
    const eyes = [ex - gap, ex + gap];
    if (mood === 'ko') {
      for (const x of eyes) { ctx.beginPath(); ctx.moveTo(x - 4 * s, ey - 4 * s); ctx.lineTo(x + 4 * s, ey + 4 * s); ctx.moveTo(x + 4 * s, ey - 4 * s); ctx.lineTo(x - 4 * s, ey + 4 * s); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(ex, ey + 12 * s, 5 * s, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = '#ff6b9a'; ctx.beginPath(); ctx.ellipse(ex + 2 * s, ey + 16 * s, 3.5 * s, 5 * s, 0, 0, TAU); ctx.fill();
    } else if (mood === 'hit') {
      ctx.beginPath(); ctx.moveTo(eyes[0] - 4 * s, ey - 3 * s); ctx.lineTo(eyes[0] + 3 * s, ey); ctx.lineTo(eyes[0] - 4 * s, ey + 3 * s);
      ctx.moveTo(eyes[1] + 4 * s, ey - 3 * s); ctx.lineTo(eyes[1] - 3 * s, ey); ctx.lineTo(eyes[1] + 4 * s, ey + 3 * s); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(ex, ey + 12 * s, 4 * s, 5.5 * s, 0, 0, TAU); ctx.fill();
    } else if (mood === 'win') {
      for (const x of eyes) { ctx.beginPath(); ctx.arc(x, ey + 2 * s, 4 * s, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(ex, ey + 7 * s, 8 * s, 0.1, Math.PI - 0.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(ex - 5 * s, ey + 7.5 * s, 10 * s, 2.5 * s);
    } else if (mood === 'sad' || mood === 'tap') {
      for (const x of eyes) { ctx.beginPath(); ctx.arc(x, ey, 2.6 * s, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.arc(ex, ey + 15 * s, 6 * s, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath(); ctx.ellipse(eyes[1] + 2 * s, ey + 7 * s + (performance.now() / 20 % 10) * s * 0.6, 2.2 * s, 3.4 * s, 0, 0, TAU); ctx.fill();
    } else {
      for (const x of eyes) { ctx.beginPath(); ctx.arc(x, ey, 3 * s, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(eyes[0] - 5 * s, ey - 8 * s); ctx.lineTo(eyes[0] + 4 * s, ey - 5 * s);
      ctx.moveTo(eyes[1] + 5 * s, ey - 8 * s); ctx.lineTo(eyes[1] - 4 * s, ey - 5 * s); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey + 9 * s, 5 * s, 0.25, Math.PI - 0.25); ctx.stroke();
    }
  };

  // ------------------------------------------------------------------ duel (1 vs 1 script)
  function duelSegments(arena, aId, bId, script, meta) {
    const segs = [];
    const fa = () => arena.fighters[aId], fb = () => arena.fighters[bId];
    const home = (side) => arena.W * (side === 'a' ? 0.33 : 0.67);
    let ground = false, top = null, hp = { a: 100, b: 100 };
    const nameOf = (side) => (side === 'a' ? fa().name : fb().name);
    const winnerSide = (script.find((e) => e.type === 'finish') || {}).winner;

    const hud = (hpBefore, hpAfter, label) => (ar, u) => {
      const ctx = ar.ctx, W = ar.W;
      const k = clamp((u - 0.35) / 0.3, 0, 1);
      const barW = Math.min(W * 0.38, 280);
      for (const side of ['a', 'b']) {
        const f = side === 'a' ? fa() : fb();
        const x = side === 'a' ? 14 : W - 14 - barW, v = lerp(hpBefore[side], hpAfter[side], k);
        ctx.fillStyle = '#26262a'; ctx.fillRect(x, 30, barW, 12);
        ctx.fillStyle = f.color;
        const w = barW * clamp(v, 0, 100) / 100;
        ctx.fillRect(side === 'a' ? x : x + barW - w, 30, w, 12);
        ctx.font = `600 14px Oswald, system-ui, sans-serif`; ctx.fillStyle = '#ffffff'; ctx.textAlign = side === 'a' ? 'left' : 'right';
        ctx.fillText(f.name, side === 'a' ? x : x + barW, 22);
      }
      if (label) { ctx.textAlign = 'center'; ctx.font = `600 15px Oswald, system-ui, sans-serif`; ctx.fillStyle = '#d4af37'; ctx.fillText(label, W / 2, 41); }
    };

    if (meta && meta.intro) {
      segs.push({
        dur: 2300, start: (ar) => { ar.stamp(meta.intro, '#ffd23f', 1000); sfx('horn'); ar.hype = 1; ar.ticker(meta.introTicker || ''); },
        hud: (ar, u) => {
          // VS splash: both faces slam in from the sides
          const ctx = ar.ctx, k = easeOut(clamp((u - 0.3) / 0.25, 0, 1)), out = clamp((u - 0.85) / 0.15, 0, 1);
          if (k <= 0) return;
          ctx.save();
          ctx.globalAlpha = 1 - out;
          ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, ar.W, ar.H);
          const size = Math.min(ar.H * 0.5, ar.W * 0.34);
          [[fa(), -1], [fb(), 1]].forEach(([f, side]) => {
            const img = f.heads && f.heads.normal;
            const x = ar.W / 2 + side * lerp(ar.W * 0.7, ar.W * 0.22, k), y = ar.H * 0.46;
            ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(x, y, size * 0.52, 0, TAU); ctx.fill();
            if (img && img.complete) { ctx.save(); ctx.translate(x, y); if (side > 0) ctx.scale(-1, 1); ctx.drawImage(img, -size / 2, -size / 2, size, size); ctx.restore(); }
            ctx.font = `600 ${16 * ar.unit}px Oswald, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
            ctx.fillText(f.name.toUpperCase(), x, y + size * 0.68);
          });
          ctx.translate(ar.W / 2, ar.H * 0.46); ctx.scale(0.6 + 0.6 * k, 0.6 + 0.6 * k); ctx.rotate(-0.12);
          ctx.font = `700 ${Math.min(80, ar.W / 6)}px Oswald, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText('VS', 0, 0);
          ctx.fillStyle = '#d20a0a'; ctx.fillText('VS', 0, 0);
          ctx.restore();
          if (u > 0.3 && !ar._vsBoom) { ar._vsBoom = true; sfx('punch'); ar.shake(6); }
          if (u < 0.1) ar._vsBoom = false;
        },
        draw: (ar, u) => [
          { f: fa(), x: lerp(ar.W * 0.1, home('a'), easeOut(u)), y: ar.floorY, facing: 1, pose: { bob: Math.sin(u * 20) * 3 } },
          { f: fb(), x: lerp(ar.W * 0.9, home('b'), easeOut(u)), y: ar.floorY, facing: -1, pose: { bob: Math.cos(u * 20) * 3 } },
        ],
      });
    }

    let roundNo = 0;
    for (const ev of script) {
      const hpBefore = { ...hp }, groundBefore = ground, topBefore = top;
      if (ev.type === 'action') {
        if (ev.action === 'takedown' && ev.landed) top = ev.actor;
        ground = ev.ground; if (!ground) top = null;
        hp = { ...ev.hp };
      }
      if (ev.type === 'finish' && ev.method === 'SUB') { ground = true; top = top || ev.winner; }
      const hpAfter = { ...hp }, groundAfter = ground, topAfter = top;
      if (ev.type === 'round') roundNo = ev.round;
      const label = roundNo ? `R${roundNo}` : '';

      if (ev.type === 'round') {
        segs.push({
          dur: 1100, hud: hud(hpBefore, hpAfter, label),
          start: (ar) => { ar.stamp(`ROUND ${ev.round}`, '#ffffff', 1000); sfx('bell'); ar.ticker(`Round ${ev.round}! 🔔`); },
          draw: (ar) => standing(ar, {}, {}),
        });
        continue;
      }

      if (ev.type === 'action') {
        let sparked = false;
        segs.push({
          dur: 760, hud: hud(hpBefore, hpAfter, label),
          start: (ar) => {
            const v = VERB[ev.action] || ['attacks', 'misses'];
            ar.ticker(ev.landed ? `${nameOf(ev.actor)} ${v[0]}` : `${nameOf(ev.actor)}'s ${v[1]}`);
            if (['cross', 'kick', 'takedown'].includes(ev.action)) sfx('whoosh');
          },
          draw: (ar, u) => {
            const pa = {}, pb = {}, P = { a: pa, b: pb };
            const me = P[ev.actor], them = P[ev.actor === 'a' ? 'b' : 'a'];
            const out = u < 0.4 ? ease(u / 0.4) : u < 0.6 ? 1 : 1 - ease((u - 0.6) / 0.4);
            const gnd = ev.action === 'takedown' && ev.landed ? u > 0.45 : (ev.action === 'stand_up' ? u < 0.5 : groundBefore);
            if (ev.action === 'jab') me.armF = out;
            if (ev.action === 'cross' || ev.action === 'ground_strike') { me.armB = out; me.lean = 0.35 * out; }
            if (ev.action === 'kick') me.kick = out;
            if (ev.action === 'takedown' && !gnd) { me.lean = out; me.crouch = 0.6 * out; }
            if (ev.action === 'sub_attempt') { me.armF = 0.6 * out; me.armB = 0.6 * out; }
            const hit = ev.landed && ['jab', 'cross', 'kick', 'ground_strike'].includes(ev.action);
            if (hit && u > 0.36 && u < 0.7) { them.flash = 1 - Math.abs(u - 0.5) * 4; them.knock = 10 * ar.unit; them.face = 'hit'; }
            if (!ev.landed && ['jab', 'cross', 'kick'].includes(ev.action)) them.guard = 1.4;
            if (hit && u > 0.38 && !sparked) {
              sparked = true;
              const tx = home(ev.actor === 'a' ? 'b' : 'a');
              ar.sparks(tx, ar.floorY - 110 * ar.unit, 14);
              sfx('punch', ev.action === 'jab' ? 0.6 : 1);
              if (ev.action !== 'jab') { ar.shake(5); if (Math.random() < 0.45) ar.pop(pick(MEMES.HIT), tx, ar.floorY - 160 * ar.unit); }
            }
            if (ev.action === 'takedown' && ev.landed && u > 0.45 && !sparked) { sparked = true; sfx('punch', 0.8); ar.shake(4); }
            return gnd ? groundPose(ar, ev.action === 'takedown' ? ev.actor : (topBefore || topAfter), P) : standing(ar, pa, pb, Math.sin(u * Math.PI) * 18 * ar.unit);
          },
        });
        continue;
      }

      if (ev.type === 'finish') {
        const w = ev.winner, l = w === 'a' ? 'b' : 'a';
        let fired = false;
        segs.push({
          dur: 3600, hud: hud(hpBefore, ev.method === 'KO' ? Object.assign({}, hpAfter, { [l]: 0 }) : hpAfter, label),
          slow: (u) => (u < 0.18 ? 0.35 : 1),
          zoom: (u) => (ev.method === 'KO' && u < 0.3 ? { x: arena.W / 2, y: arena.floorY - 80 * arena.unit, k: 1 + 0.25 * Math.sin((u / 0.3) * Math.PI) } : null),
          start: (ar) => {
            const n = nameOf(w);
            ar.ticker(ev.method === 'KO' ? `${n} wins by KNOCKOUT! 💥` : ev.method === 'SUB' ? `${n} wins by submission (${ev.hold})! 🥨` : `${n} wins by decision (${ev.cards}) 📋`);
          },
          draw: (ar, u) => {
            const pw = { face: 'normal' }, pl = {}, P = { [w]: pw, [l]: pl };
            if (!fired && u > 0.05) {
              fired = true;
              if (ev.method === 'KO') {
                sfx('boom'); ar.flash(); ar.shake(10);
                ar.sparks(home(l), ar.floorY - 110 * ar.unit, 26);
                ar.burst(home(l), ar.floorY - 120 * ar.unit, ['💥', '⭐', '💀', '😵', '🦷'], 14, 1.2);
                ar.stamp('K.O.!', '#ff4d6d', 1600);
              } else if (ev.method === 'SUB') { sfx('tap'); ar.stamp('TAP OUT!', '#2de2e6', 1600); }
              else { sfx('bell'); ar.stamp('DECISION', '#ffd23f', 1500); }
              setTimeout(() => {
                const memeSet = meta && meta.upset ? MEMES.UPSET : MEMES[ev.method];
                ar.meme(pick(memeSet));
                sfx(ev.method === 'DEC' ? 'crowd' : 'sad'); sfx('crowd', 1.2);
                ar.burst(home(w), ar.floorY - 140 * ar.unit, ['🔥', '👑', '💯', '🐐', '😂'], 12);
              }, 900 / ar.speed);
            }
            if (ev.method === 'KO') {
              pl.lie = easeOut(clamp(u / 0.25, 0, 1)); pl.face = 'ko';
              pw.armB = u < 0.12 ? 1 : 0; pw.raise = ease(clamp((u - 0.3) / 0.2, 0, 1)); pw.face = u > 0.3 ? 'win' : 'normal';
              return standing(ar, P.a, P.b);
            }
            if (ev.method === 'SUB') {
              if (u < 0.6) { pl.face = 'tap'; pl.tap = 1; pw.armF = 0.7; pw.armB = 0.7; return groundPose(ar, w, P); }
              pl.lie = 1; pl.face = 'ko'; pw.raise = ease(clamp((u - 0.6) / 0.2, 0, 1)); pw.face = 'win';
              return standing(ar, P.a, P.b);
            }
            pw.raise = ease(clamp((u - 0.35) / 0.2, 0, 1)); pw.face = u > 0.35 ? 'win' : 'normal';
            pl.face = u > 0.35 ? 'sad' : 'normal'; pl.guard = 0.5;
            return standing(ar, P.a, P.b);
          },
        });
      }
    }

    function standing(ar, pa, pb, close) {
      const c = close || 0;
      return [
        { f: fa(), x: home('a') + c, y: ar.floorY, facing: 1, pose: Object.assign({ bob: Math.sin(performance.now() / 160) * 2 }, pa) },
        { f: fb(), x: home('b') - c, y: ar.floorY, facing: -1, pose: Object.assign({ bob: Math.cos(performance.now() / 160) * 2 }, pb) },
      ];
    }
    function groundPose(ar, topSide, P) {
      const t = topSide || winnerSide || 'a', b = t === 'a' ? 'b' : 'a';
      const pt = Object.assign({ crouch: 1, lean: 0.8 }, P[t]), pbm = Object.assign({ lie: 1 }, P[b]);
      if (!P[b].face) pbm.face = 'hit';
      const fx = { a: fa(), b: fb() };
      return [
        { f: fx[b], x: ar.W / 2 + (b === 'a' ? -14 : 14), y: ar.floorY, facing: b === 'a' ? 1 : -1, pose: pbm },
        { f: fx[t], x: ar.W / 2 + (t === 'a' ? -60 : 60) * ar.unit, y: ar.floorY, facing: t === 'a' ? 1 : -1, pose: pt },
      ];
    }
    return segs;
  }

  // ------------------------------------------------------------------ battle royale (ranking mode)
  function brawlSegments(arena, ids, eliminations, final, finalMeta) {
    const segs = [];
    const alive = new Set(ids);
    const slots = {};
    const layoutSlots = () => {
      const n = ids.length, W = arena.W;
      ids.forEach((id, i) => {
        const twoRows = n > 6;
        const row = twoRows ? i % 2 : 0;
        const perRow = twoRows ? Math.ceil(n / 2) : n;
        const col = twoRows ? Math.floor(i / 2) : i;
        const step = perRow === 1 ? 0 : 0.76 / (perRow - 1);
        // back row sits half a step to the side so it shows between the front-row fighters
        const x = W * (perRow === 1 ? 0.5 : 0.12 + step * col + (row ? step / 2 : 0) - (twoRows ? step / 4 : 0));
        // shrink fighters when many share a narrow stage, so bodies and name tags don't overlap
        const fit = clamp((W * 0.76) / (Math.max(1, perRow) * 105 * arena.unit), 0.5, 1);
        slots[id] = { x, y: arena.floorY - (row ? 30 * arena.unit * fit : 0), scale: (row ? 0.85 : 1) * fit, facing: x < W / 2 ? 1 : -1 };
      });
    };
    arena.layout = layoutSlots;
    layoutSlots();
    const crowd = (ar, overrides) => [...alive].filter((id) => !(overrides && overrides[id] === null)).map((id) => {
      const sl = slots[id];
      const o = (overrides && overrides[id]) || {};
      return { f: ar.fighters[id], x: o.x !== undefined ? o.x : sl.x, y: o.y !== undefined ? o.y : sl.y, facing: o.facing || sl.facing,
        pose: Object.assign({ scale: sl.scale, bob: Math.sin(performance.now() / 150 + sl.x) * 3 }, o.pose || {}) };
    });
    const countHud = (ar) => {
      const ctx = ar.ctx;
      ctx.textAlign = 'left'; ctx.font = `600 14px Oswald, system-ui, sans-serif`; ctx.fillStyle = '#d4af37';
      ctx.fillText(`${alive.size} FIGHTERS LEFT`, 14, ar.H - 12);
    };

    segs.push({
      dur: 2000, hud: countHud,
      start: (ar) => { ar.stamp('BATTLE ROYALE', '#ff3d8b', 1900); sfx('horn'); ar.hype = 1; ar.ticker(`${ids.length} fighters enter. Only one leaves with the crown 👑`); },
      draw: (ar, u) => crowd(ar, Object.fromEntries([...alive].map((id) => [id, { pose: { bob: Math.sin(u * 30 + slots[id].x) * 5, armF: Math.max(0, Math.sin(u * 12 + slots[id].x)) * 0.5 } }]))),
    });

    for (const el of eliminations) {
      const atk = el.attacker, vic = el.victim;
      let fired = false;
      segs.push({
        dur: 2700, hud: countHud,
        start: (ar) => {
          const a = ar.fighters[atk].name, v = ar.fighters[vic].name;
          const how = { KO: 'KO 💥', SUB: 'submission 🥨', DEC: 'decision 📋' }[el.method];
          ar.ticker(`#${el.place} ${v} is OUT. ${a} (${Math.round(el.p * 100)}% favourite) wins by ${how}`);
          sfx('whoosh');
        },
        draw: (ar, u) => {
          const sa = slots[atk], sv = slots[vic];
          const dir = sv.x >= sa.x ? 1 : -1;
          const strikeX = sv.x - dir * 52 * ar.unit * sv.scale;
          const o = {};
          let ax = sa.x;
          if (u < 0.22) ax = lerp(sa.x, strikeX, ease(u / 0.22));
          else if (u < 0.75) ax = strikeX;
          else ax = lerp(strikeX, sa.x, ease((u - 0.75) / 0.25));
          const ap = { scale: sv.scale };
          const vp = { scale: sv.scale };
          if (u >= 0.22 && u < 0.4) {
            const k = Math.sin(((u - 0.22) / 0.18) * Math.PI);
            if (el.method === 'SUB') { ap.crouch = k; ap.lean = k; } else if (el.method === 'DEC') { ap.armF = k; ap.armB = 1 - k; } else { ap.armB = k; ap.lean = 0.4 * k; }
          }
          if (!fired && u > 0.32) {
            fired = true;
            ar.sparks(sv.x, sv.y - 100 * ar.unit * sv.scale, 18);
            if (el.method === 'KO') { sfx('boom'); ar.shake(9); ar.flash(); ar.burst(sv.x, sv.y - 110 * ar.unit, ['💥', '💀', '⭐', '🦷'], 10); }
            else if (el.method === 'SUB') { sfx('tap'); ar.burst(sv.x, sv.y - 80 * ar.unit, ['🥨', '👋', '😵'], 8); }
            else { sfx('punch'); sfx('sad'); ar.burst(sv.x, sv.y - 110 * ar.unit, ['😭', '📋', '💧'], 8); }
            ar.meme(pick(el.method === 'KO' ? MEMES.KO : el.method === 'SUB' ? MEMES.SUB : MEMES.OUT));
            sfx('crowd', 0.8);
          }
          // victim reaction
          let vx = sv.x, vy = sv.y;
          if (u > 0.32) {
            const k = clamp((u - 0.32) / 0.6, 0, 1);
            if (el.method === 'KO') {
              vx = sv.x + dir * k * ar.W * 0.7; vy = sv.y - Math.sin(k * Math.PI) * 140 * ar.unit;
              vp.spin = dir * k * 9; vp.face = 'ko'; vp.alpha = 1 - clamp((k - 0.7) / 0.3, 0, 1);
            } else if (el.method === 'SUB') {
              vp.lie = Math.min(1, k * 3); vp.face = 'tap'; vp.tap = k < 0.6 ? 1 : 0; vp.alpha = 1 - clamp((k - 0.65) / 0.35, 0, 1);
            } else {
              vp.face = 'sad'; vx = sv.x + dir * k * ar.W * 0.5; vp.alpha = 1 - clamp((k - 0.6) / 0.4, 0, 1); vp.guard = 0.4;
            }
          } else if (u > 0.22) { vp.face = 'hit'; }
          if (u > 0.45) { ap.face = 'win'; ap.raise = u > 0.5 && u < 0.75 ? 1 : 0; }
          o[atk] = { x: ax, facing: dir, pose: ap };
          o[vic] = { x: vx, y: vy, facing: -dir, pose: vp };
          return crowd(ar, o);
        },
      });
      segs.push({ dur: 1, start: () => { alive.delete(vic); }, draw: (ar) => crowd(ar), hud: countHud });
    }

    if (final) {
      const fa = final.a, fb = final.b;
      segs.push({
        dur: 1900, hud: countHud, mark: 'final',
        start: (ar) => { ar.stamp('FINAL BOSS FIGHT', '#ffd23f', 1800); sfx('horn'); ar.ticker(`The last two standing: ${ar.fighters[fa].name} vs ${ar.fighters[fb].name}`); },
        draw: (ar, u) => {
          const k = ease(u);
          return crowd(ar, {
            [fa]: { x: lerp(slots[fa].x, ar.W * 0.33, k), y: lerp(slots[fa].y, ar.floorY, k), facing: 1, pose: { scale: lerp(slots[fa].scale, 1, k) } },
            [fb]: { x: lerp(slots[fb].x, ar.W * 0.67, k), y: lerp(slots[fb].y, ar.floorY, k), facing: -1, pose: { scale: lerp(slots[fb].scale, 1, k) } },
          });
        },
      });
      segs.push(...duelSegments(arena, fa, fb, final.script, finalMeta));
    }
    return segs;
  }

  function celebration(arena, winnerId, title) {
    return [{
      dur: 2600,
      start: (ar) => { ar.confetti(160); sfx('horn'); sfx('crowd', 1.4); ar.meme(pick(MEMES.WIN), { bottom: true, life: 2400 }); if (title) ar.stamp(title, '#ffd23f', 2400); },
      draw: (ar, u) => [{ f: ar.fighters[winnerId], x: ar.W / 2, y: ar.floorY, facing: 1, pose: { raise: 1, face: 'win', bob: Math.abs(Math.sin(u * 14)) * -14 * ar.unit, scale: 1.25 } }],
      hud: (ar) => {
        const ctx = ar.ctx; ctx.font = `${44 * ar.unit}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('👑', ar.W / 2, ar.floorY - 175 * ar.unit + Math.sin(performance.now() / 200) * 4);
      },
    }];
  }

  // ------------------------------------------------------------------ public API
  window.ArenaShow = {
    MEMES,
    create(canvas, players, opts) {
      const ar = new Arena(canvas, opts);
      players.forEach((p, i) => ar.addFighter(p.id, p, i));
      return ar;
    },
    duel(ar, fight, meta) { return duelSegments(ar, fight.a, fight.b, fight.script, meta); },
    brawl(ar, ids, show, finalMeta) { return [...brawlSegments(ar, ids, show.eliminations, show.final, finalMeta), ...celebration(ar, show.final.winner, 'CHAMPION')]; },
    celebrate: celebration,
    idle(ar, aId, bId) {
      // looping demo for the home page
      const segs = [];
      for (let k = 0; k < 4; k++) {
        const actor = k % 2 ? 'b' : 'a';
        segs.push({
          dur: 1300,
          draw: (a, u) => {
            const out = Math.sin(clamp((u - 0.3) / 0.4, 0, 1) * Math.PI);
            const pa = { bob: Math.sin(performance.now() / 160) * 2 }, pb = { bob: Math.cos(performance.now() / 160) * 2 };
            const me = actor === 'a' ? pa : pb, them = actor === 'a' ? pb : pa;
            if (k === 3) me.kick = out; else me.armF = out;
            if (out > 0.8) { them.face = 'hit'; them.knock = 8 * a.unit; }
            return [{ f: a.fighters[aId], x: a.W * 0.36 + out * (actor === 'a' ? 14 : 0), y: a.floorY, facing: 1, pose: pa },
              { f: a.fighters[bId], x: a.W * 0.64 - out * (actor === 'b' ? 14 : 0), y: a.floorY, facing: -1, pose: pb }];
          },
        });
      }
      return segs;
    },
  };
})();
