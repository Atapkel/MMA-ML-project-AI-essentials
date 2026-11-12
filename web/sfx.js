/* Sound effects synthesized with the Web Audio API (no audio files needed).
 * Browsers only allow sound after a tap, so Sfx.enable() is called from a click. */
(function () {
  let ctx = null, master = null, on = false;
  try { on = localStorage.getItem('arena:sound') === 'on'; } catch (e) { /* private mode */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise(duration) {
    const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * duration), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(type, freq, t, dur, peak, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env(g, t, 0.01, peak, dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const S = {
    get enabled() { return on; },
    enable() { on = true; ensure(); try { localStorage.setItem('arena:sound', 'on'); } catch (e) { /* ignore */ } },
    disable() { on = false; try { localStorage.setItem('arena:sound', 'off'); } catch (e) { /* ignore */ } },
    play(name, intensity) {
      if (!on || !ensure()) return;
      const t = ctx.currentTime, k = intensity || 1;
      switch (name) {
        case 'punch': {
          const n = noise(0.15), f = ctx.createBiquadFilter(), g = ctx.createGain();
          f.type = 'lowpass'; f.frequency.value = 900;
          env(g, t, 0.005, 0.9 * k, 0.12);
          n.connect(f).connect(g).connect(master); n.start(t);
          tone('sine', 140, t, 0.12, 0.7 * k, 50);
          break;
        }
        case 'whoosh': {
          const n = noise(0.25), f = ctx.createBiquadFilter(), g = ctx.createGain();
          f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2500, t + 0.2);
          env(g, t, 0.05, 0.35, 0.18);
          n.connect(f).connect(g).connect(master); n.start(t);
          break;
        }
        case 'boom': { // deep meme-style boom for the finishing blow
          tone('sine', 120, t, 1.1, 1.0, 32);
          tone('triangle', 60, t, 0.9, 0.6, 28);
          const n = noise(0.3), f = ctx.createBiquadFilter(), g = ctx.createGain();
          f.type = 'lowpass'; f.frequency.value = 300;
          env(g, t, 0.005, 0.8, 0.3);
          n.connect(f).connect(g).connect(master); n.start(t);
          break;
        }
        case 'bell': [880, 1320, 1760].forEach((f, i) => { tone('sine', f, t, 1.4, 0.25 / (i + 1)); tone('sine', f, t + 0.35, 1.2, 0.2 / (i + 1)); }); break;
        case 'horn': [440, 554, 659].forEach((f) => { for (let r = 0; r < 3; r++) tone('sawtooth', f, t + r * 0.18, 0.14, 0.12); }); break;
        case 'sad': [392, 370, 349, 330].forEach((f, i) => tone('triangle', f, t + i * 0.32, i === 3 ? 0.9 : 0.28, 0.3, i === 3 ? 300 : null)); break;
        case 'boing': tone('sine', 220, t, 0.35, 0.5, 880); break;
        case 'tap': [0, 0.12, 0.24].forEach((d) => tone('square', 900, t + d, 0.05, 0.12)); break;
        case 'crowd': {
          const n = noise(1.6), f = ctx.createBiquadFilter(), g = ctx.createGain();
          f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.6;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * k, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
          n.connect(f).connect(g).connect(master); n.start(t);
          break;
        }
        default: break;
      }
    },
  };
  window.Sfx = S;
})();
