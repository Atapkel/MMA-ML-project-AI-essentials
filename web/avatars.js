/* Procedural cartoon fighter avatars (original art, generated in the browser, no external images).
 * Avatar.svg(seed, {color, sex, mood, bg}) -> SVG string. The same seed always gives the same face.
 * Moods: normal | hit | ko | win | sad. */
(function () {
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

  const SKINS = ['#f8d9bd', '#efc19a', '#d9a173', '#b57b4f', '#8d5b38', '#5f3b24'];
  const HAIR = ['#1f1a17', '#3b2416', '#6b4423', '#c9a15a', '#a3401f', '#9ca3af'];

  function features(seed, sex) {
    const r = rng(seed);
    const female = sex === 'F';
    return {
      skin: pick(r, SKINS),
      hairColor: r() < 0.12 ? null : pick(r, HAIR), // null: dyed in player colour
      hair: female ? pick(r, ['bun', 'long', 'ponytail', 'buzz', 'afro', 'spiky']) : pick(r, ['bald', 'buzz', 'mohawk', 'spiky', 'afro', 'bun', 'long', 'buzz', 'spiky']),
      beard: female ? 'none' : pick(r, ['none', 'none', 'stubble', 'beard', 'mustache', 'goatee']),
      brow: pick(r, ['angry', 'angry', 'flat', 'raised']),
      extra: pick(r, ['none', 'blackeye', 'bandage', 'scar', 'shades', 'headband', 'headband', 'mouthguard', 'ear']),
      tilt: (r() - 0.5) * 8,
    };
  }

  function hairSvg(f, color) {
    const c = f.hairColor || color;
    switch (f.hair) {
      case 'bald': return '<ellipse cx="40" cy="27" rx="7" ry="3" fill="#fff" opacity=".35"/>';
      case 'buzz': return `<path d="M22 44 C22 22 78 22 78 44 C72 32 28 32 22 44 Z" fill="${c}"/>`;
      case 'mohawk': return `<path d="M44 14 L50 6 L56 14 L57 34 L43 34 Z" fill="${c}"/>`;
      case 'spiky': return `<path d="M22 42 L24 24 L32 30 L36 16 L44 26 L50 12 L56 26 L64 16 L68 30 L76 24 L78 42 C70 30 30 30 22 42 Z" fill="${c}"/>`;
      case 'afro': return `<circle cx="50" cy="36" r="31" fill="${c}"/>`;
      case 'bun': return `<circle cx="50" cy="13" r="9" fill="${c}"/><path d="M21 46 C20 20 80 20 79 46 C70 30 30 30 21 46 Z" fill="${c}"/>`;
      case 'ponytail': return `<path d="M76 34 C92 40 90 62 82 70 C84 56 80 46 74 42 Z" fill="${c}"/><path d="M21 46 C20 20 80 20 79 46 C70 30 30 30 21 46 Z" fill="${c}"/>`;
      case 'long': return `<path d="M18 70 C12 30 30 16 50 16 C70 16 88 30 82 70 L76 70 C78 44 70 32 50 32 C30 32 22 44 24 70 Z" fill="${c}"/>`;
      default: return '';
    }
  }

  function eyesSvg(mood, f) {
    const L = 40, R = 60, y = 50;
    if (mood === 'ko') return `<path d="M${L - 4} ${y - 4} l8 8 M${L + 4} ${y - 4} l-8 8 M${R - 4} ${y - 4} l8 8 M${R + 4} ${y - 4} l-8 8" stroke="#1b1238" stroke-width="3" stroke-linecap="round"/>`;
    if (mood === 'hit') return `<path d="M${L - 5} ${y - 4} l7 4 l-7 4 M${R + 5} ${y - 4} l-7 4 l7 4" stroke="#1b1238" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (mood === 'win') return `<path d="M${L - 5} ${y + 1} q5 -7 10 0 M${R - 5} ${y + 1} q5 -7 10 0" stroke="#1b1238" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    const eyes = `<circle cx="${L}" cy="${y}" r="3.6" fill="#1b1238"/><circle cx="${R}" cy="${y}" r="3.6" fill="#1b1238"/><circle cx="${L + 1}" cy="${y - 1}" r="1.1" fill="#fff"/><circle cx="${R + 1}" cy="${y - 1}" r="1.1" fill="#fff"/>`;
    const brows = { angry: `M${L - 7} ${y - 10} l12 4 M${R + 7} ${y - 10} l-12 4`, flat: `M${L - 6} ${y - 9} h11 M${R - 5} ${y - 9} h11`, raised: `M${L - 6} ${y - 8} q6 -6 11 0 M${R - 5} ${y - 8} q6 -6 11 0` }[f.brow];
    const tear = mood === 'sad' ? `<path d="M${R + 3} ${y + 5} q3 6 0 9 q-3 -3 0 -9 Z" fill="#60a5fa"/>` : '';
    const sadBrows = mood === 'sad' ? `<path d="M${L - 6} ${y - 7} l11 -4 M${R + 6} ${y - 7} l-11 -4" stroke="#1b1238" stroke-width="3" stroke-linecap="round"/>` : '';
    return eyes + (mood === 'sad' ? sadBrows : `<path d="${brows}" stroke="#1b1238" stroke-width="3" fill="none" stroke-linecap="round"/>`) + tear;
  }

  function mouthSvg(mood, f, color) {
    if (mood === 'ko') return '<path d="M42 66 q4 -3 8 0 q4 3 8 0" stroke="#1b1238" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M50 67 q1 9 6 7 q2 -4 -2 -7 Z" fill="#f472b6"/>';
    if (mood === 'hit') return '<ellipse cx="50" cy="67" rx="4.5" ry="6" fill="#1b1238"/>';
    if (mood === 'win') return `<path d="M38 62 Q50 78 62 62 Z" fill="#1b1238"/><path d="M41 63 h18 v3 h-18 Z" fill="${f.extra === 'mouthguard' ? color : '#fff'}"/>`;
    if (mood === 'sad') return '<path d="M42 70 q8 -7 16 0" stroke="#1b1238" stroke-width="3" fill="none" stroke-linecap="round"/>';
    if (f.extra === 'mouthguard') return `<path d="M40 64 q10 7 20 0 v3 q-10 7 -20 0 Z" fill="${color}" stroke="#1b1238" stroke-width="1.5"/>`;
    return f.brow === 'angry' ? '<path d="M42 66 h16" stroke="#1b1238" stroke-width="3" stroke-linecap="round"/>' : '<path d="M42 64 q9 6 17 -1" stroke="#1b1238" stroke-width="3" fill="none" stroke-linecap="round"/>';
  }

  function beardSvg(f) {
    const c = f.hairColor || '#1f1a17';
    switch (f.beard) {
      case 'beard': return `<path d="M24 56 C26 86 74 86 76 56 C70 70 30 70 24 56 Z" fill="${c}"/>`;
      case 'mustache': return `<path d="M38 61 q6 -5 12 -1 q6 -4 12 1 q-6 3 -12 1 q-6 2 -12 -1 Z" fill="${c}"/>`;
      case 'goatee': return `<path d="M44 72 q6 10 12 0 q-6 3 -12 0 Z" fill="${c}"/>`;
      case 'stubble': return `<g fill="${c}" opacity=".45">${[[36, 70], [42, 74], [50, 76], [58, 74], [64, 70], [46, 79], [54, 79]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2"/>`).join('')}</g>`;
      default: return '';
    }
  }

  function extraSvg(f, mood, color) {
    switch (f.extra) {
      case 'blackeye': return '<ellipse cx="60" cy="51" rx="9" ry="7" fill="#7c3aed" opacity=".35"/>';
      case 'bandage': return '<g transform="rotate(-25 34 60)"><rect x="26" y="57" width="16" height="6" rx="2" fill="#f5deb3"/><path d="M31 57 v6 M37 57 v6" stroke="#d4b483"/></g>';
      case 'scar': return '<path d="M64 38 l6 16 M64 43 l4 -1 M66 48 l4 -1" stroke="#b45309" stroke-width="1.6" opacity=".7"/>';
      case 'shades': return mood === 'normal' || mood === 'win' ? '<path d="M30 46 h40 v4 q-1 8 -9 8 q-7 0 -8 -8 h-6 q-1 8 -8 8 q-8 0 -9 -8 Z" fill="#111"/>' : '';
      case 'headband': return `<rect x="21" y="35" width="58" height="7" rx="2" fill="${color}"/><path d="M78 37 l10 -4 l-3 8 Z" fill="${color}"/>`;
      case 'ear': return '<circle cx="21" cy="55" r="5" fill="#e7a8a8"/><circle cx="19" cy="52" r="2.5" fill="#d48f8f"/>';
      default: return '';
    }
  }

  window.Avatar = {
    seed(id, name) { return (Number(id) * 2654435761) ^ hash(name); },
    svg(seed, opts) {
      const o = Object.assign({ color: '#e11d48', sex: 'M', mood: 'normal', bg: true }, opts);
      const f = features(seed, o.sex);
      const mood = o.mood === 'tap' ? 'sad' : o.mood;
      const sweat = mood === 'hit' ? '<path d="M76 34 q4 7 0 10 q-4 -3 0 -10 Z" fill="#7dd3fc"/>' : '';
      const stars = mood === 'ko' ? '<text x="50" y="18" font-size="14" text-anchor="middle">💫</text>' : '';
      const back = f.hair === 'afro' || f.hair === 'long' || f.hair === 'ponytail' ? hairSvg(f, o.color) : '';
      const front = back ? (f.hair === 'afro' ? '' : '') : hairSvg(f, o.color);
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        ${o.bg ? `<circle cx="50" cy="50" r="50" fill="${o.color}" opacity=".14"/>` : ''}
        <g transform="rotate(${mood === 'ko' ? 14 : f.tilt} 50 55)">
          ${back}
          <circle cx="23" cy="54" r="6" fill="${f.skin}"/><circle cx="77" cy="54" r="6" fill="${f.skin}"/>
          <ellipse cx="50" cy="52" rx="28" ry="30" fill="${f.skin}"/>
          ${front}${beardSvg(f)}${eyesSvg(mood, f)}
          <path d="M50 53 q-3 6 0 8" stroke="#1b1238" stroke-width="2" fill="none" opacity=".35" stroke-linecap="round"/>
          ${mouthSvg(mood, f, o.color)}${extraSvg(f, mood, o.color)}${sweat}
        </g>${stars}
      </svg>`;
    },
    skin(seed, sex) { return features(seed, sex).skin; },
    img(seed, opts) { const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(this.svg(seed, opts)); return im; },
  };
})();
