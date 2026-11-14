/* AI Lab: charts of how the trained models behave, plus the explainable-AI pieces used in fights
   (SHAP-style waterfall). Plain SVG/HTML, no libraries, so it works offline. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (p) => `${Math.round(p * 100)}%`;
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const FACTOR = {
    size: ['⚖️', 'Body size'], strength: ['💪', 'Strength & fitness'], striking: ['🥊', 'Striking'], wrestling: ['🤼', 'Wrestling'],
    grappling: ['🥋', 'Grappling'], experience: ['🎖️', 'Experience'], reach: ['📏', 'Reach & height'], age: ['🎂', 'Age'], stance: ['🔄', 'Stance'],
  };

  // ------------------------------------------------------------------ tooltip (one for the whole page)
  // Any element with data-tip="line 1\nline 2" shows it on hover / focus. Text goes in with textContent.
  const tip = document.createElement('div');
  tip.className = 'viz-tip'; tip.hidden = true; document.body.appendChild(tip);
  function showTip(lines, x, y) {
    tip.replaceChildren(...lines.map((t, i) => { const d = document.createElement('div'); if (i === 0) d.className = 'v'; d.textContent = t; return d; }));
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, x + 14))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) showTip(el.dataset.tip.split('\n'), e.clientX, e.clientY);
    else if (!e.target.closest || !e.target.closest('.viz-line')) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); showTip(el.dataset.tip.split('\n'), r.left, r.top); }
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, { passive: true });

  // ------------------------------------------------------------------ waterfall (exact SHAP values of a logit model)
  // contrib: log-odds part of each factor for fighter A. Starting from 50% (two equal fighters), the
  // factors are added biggest first; the steps add up exactly to the model's final chance.
  function waterfall(contrib, aName, bName, aColor, bColor) {
    if (!contrib) return '';
    const items = Object.entries(contrib).filter(([, v]) => Math.abs(v) >= 0.01).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
    const small = Object.entries(contrib).filter(([, v]) => Math.abs(v) < 0.01).reduce((s, [, v]) => s + v, 0);
    if (Math.abs(small) >= 0.001) items.push(['other', small]);
    let logit = 0;
    const rows = items.map(([g, v]) => {
      const p0 = sigmoid(logit); logit += v; const p1 = sigmoid(logit);
      const [icon, label] = FACTOR[g] || ['·', 'Other factors'];
      const who = v > 0 ? aName : bName, color = v > 0 ? aColor : bColor;
      const lo = Math.min(p0, p1) * 100, w = Math.max(0.6, Math.abs(p1 - p0) * 100);
      const pts = (p1 - p0) * 100;
      const sign = Math.round(pts) > 0 ? '+' : Math.round(pts) < 0 ? '−' : '';
      const tipText = `${pts >= 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)} pts for ${aName}\n${label}: helps ${who}\nSHAP value ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)} log-odds\n${pct(p0)} → ${pct(p1)}`;
      return `<div class="wf-row" tabindex="0" data-tip="${esc(tipText)}"><span class="wf-l">${icon} ${esc(label)}</span>
        <span class="wf-t"><b class="mid"></b><i style="left:${lo}%;width:${w}%;background:${color}"></i></span>
        <span class="wf-v">${sign}${Math.abs(Math.round(pts))}<small> → ${pct(p1)}</small></span></div>`;
    }).join('');
    const pFinal = sigmoid(logit);
    return `<div class="wf" role="group" aria-label="How each factor moves ${esc(aName)}'s chance">
      <div class="wf-row start"><span class="wf-l">Equal fighters</span><span class="wf-t"><b class="mid"></b><i class="dotm" style="left:50%"></i></span><span class="wf-v">50%</span></div>
      ${rows}
      <div class="wf-row end"><span class="wf-l"><b>AI chance</b></span><span class="wf-t"><b class="mid"></b><i style="left:0;width:${pFinal * 100}%;background:${aColor};opacity:.9"></i></span><span class="wf-v"><b>${pct(pFinal)}</b></span></div>
      <div class="wf-axis"><span></span><span class="wf-ticks"><em>0%</em><em>50%</em><em>100%</em></span><span></span></div>
      <p class="tiny muted">${esc(aName)}'s chance against ${esc(bName)}, built up factor by factor (biggest first). The model adds factors in log-odds, so each
        step is that factor's exact SHAP value, and the steps sum to the final chance.</p></div>`;
  }

  // ------------------------------------------------------------------ line chart with crosshair
  const REG = {};
  let nextId = 0;
  const W = 400, H = 236, M = { l: 44, r: 14, t: 14, b: 38 };
  function lineChart(o) {
    const id = `vz${nextId += 1}`;
    const X = (v) => M.l + ((v - o.x.min) / (o.x.max - o.x.min)) * (W - M.l - M.r);
    const Y = (v) => H - M.b - ((v - o.y.min) / (o.y.max - o.y.min)) * (H - M.t - M.b);
    REG[id] = Object.assign({}, o, { X, Y });
    const grid = o.y.ticks.map((t) => `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(t)}" y2="${Y(t)}" class="g"/><text x="${M.l - 6}" y="${Y(t) + 4}" text-anchor="end">${esc(o.y.fmt(t))}</text>`).join('');
    const xt = o.x.ticks.map((t) => `<text x="${X(t)}" y="${H - M.b + 16}" text-anchor="middle">${esc(o.x.fmt(t))}</text>`).join('');
    const ref = o.ref ? `<line x1="${X(o.ref[0][0])}" y1="${Y(o.ref[0][1])}" x2="${X(o.ref[1][0])}" y2="${Y(o.ref[1][1])}" class="ref"/>` : '';
    const area = o.area ? `<path d="M${X(o.series[0].pts[0][0])},${Y(o.y.min)}L${o.series[0].pts.map(([x, y]) => `${X(x)},${Y(y)}`).join('L')}L${X(o.series[0].pts.at(-1)[0])},${Y(o.y.min)}Z" fill="${o.series[0].color}" opacity=".12"/>` : '';
    const lines = o.series.map((s) => `<path d="M${s.pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('L')}" stroke="${s.color}" class="ln"/>`
      + (s.dots ? s.pts.map(([x, y]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="4.5" fill="${s.color}" class="dt"/>`).join('') : '')).join('');
    const ends = o.series.length > 1 ? o.series.map((s) => { const [x, y] = s.pts.at(-1); return `<text x="${X(x) - 4}" y="${Y(y) - 8}" text-anchor="end" class="lbl">${esc(s.name)}</text>`; }).join('') : '';
    const placed = [];
    const marks = (o.marks || []).map((m) => {
      const x = X(m.x), y = Y(m.y), w = m.label.length * 5.6 + 8;
      const free = !placed.some((b) => x < b.x + b.w && b.x < x + w && Math.abs(b.y - y) < 12);
      if (free) placed.push({ x, y, w });
      return `<g class="mkg" data-tip="${esc(m.tip || m.label)}"><circle cx="${x}" cy="${y}" r="9" fill="transparent"/><circle cx="${x}" cy="${y}" r="5.5" fill="${m.color || 'var(--text)'}" class="mk"/></g>
        ${free ? `<text x="${x + 8}" y="${y + 4}" class="mk-l">${esc(m.label)}</text>` : ''}`;
    }).join('');
    const legend = o.series.length > 1 ? `<div class="viz-legend">${o.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    return `${legend}<svg class="viz-line" data-chart="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}">
      ${grid}<line x1="${M.l}" x2="${W - M.r}" y1="${Y(o.y.min)}" y2="${Y(o.y.min)}" class="ax"/>${xt}
      <text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle" class="axl">${esc(o.x.label)}</text>
      <text x="12" y="${(M.t + H - M.b) / 2}" text-anchor="middle" class="axl" transform="rotate(-90 12 ${(M.t + H - M.b) / 2})">${esc(o.y.label)}</text>
      ${ref}${area}${lines}${ends}
      <line class="xh" y1="${M.t}" y2="${H - M.b}" visibility="hidden"/>${o.series.map((s, i) => `<circle class="xd" data-s="${i}" r="5" fill="${s.color}" visibility="hidden"/>`).join('')}
      <rect class="hit" x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}"/>${marks}</svg>`;
  }
  document.addEventListener('pointermove', (e) => {
    const svg = e.target.closest && e.target.closest('.viz-line');
    if (!svg || e.target.closest('[data-tip]')) return; // a player dot shows its own tooltip
    const o = REG[svg.dataset.chart];
    if (!o) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const xv = o.x.min + ((px - M.l) / (W - M.l - M.r)) * (o.x.max - o.x.min);
    const base = o.series[0].pts;
    let i = 0;
    base.forEach((p, k) => { if (Math.abs(p[0] - xv) < Math.abs(base[i][0] - xv)) i = k; });
    const x = base[i][0];
    const xh = svg.querySelector('.xh');
    xh.setAttribute('x1', o.X(x)); xh.setAttribute('x2', o.X(x)); xh.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.xd').forEach((c) => {
      const p = o.series[Number(c.dataset.s)].pts[i];
      if (!p) return;
      c.setAttribute('cx', o.X(p[0])); c.setAttribute('cy', o.Y(p[1])); c.setAttribute('visibility', 'visible');
    });
    const lines = o.tip ? o.tip(i) : [o.x.fmt(x), ...o.series.map((s) => `${s.name}: ${o.y.fmt(s.pts[i][1])}`)];
    showTip(lines, e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => {
    const svg = e.target.closest && e.target.closest('.viz-line');
    if (!svg || svg.contains(e.relatedTarget)) return;
    svg.querySelectorAll('.xh,.xd').forEach((n) => n.setAttribute('visibility', 'hidden'));
    hideTip();
  });

  // ------------------------------------------------------------------ bars and heatmaps (HTML)
  function hbars(rows, o = {}) {
    const max = o.max || Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
    return `<div class="vb${o.stack ? ' stack' : ''}">${rows.map((r) => `<div class="vb-row${r.strong ? ' strong' : ''}" tabindex="0" data-tip="${esc(r.tip || `${r.valueText}\n${r.label}`)}">
      <span class="vb-l">${esc(r.label)}</span><span class="vb-t"><i style="width:${Math.max(0.8, (Math.max(0, r.value) / max) * 100)}%;background:${r.color}"></i></span>
      <span class="vb-v">${esc(r.valueText)}</span></div>`).join('')}</div>`;
  }
  function divbars(rows) {
    const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
    return `<div class="vb div">${rows.map((r) => {
      const w = (Math.abs(r.value) / max) * 50;
      return `<div class="vb-row" tabindex="0" data-tip="${esc(r.tip)}"><span class="vb-l">${esc(r.label)}</span>
        <span class="vb-t"><b class="mid"></b><i style="${r.value >= 0 ? `left:50%` : `left:${50 - w}%`};width:${Math.max(0.8, w)}%;background:${r.value >= 0 ? 'var(--viz-pos)' : 'var(--viz-neg)'}"></i></span>
        <span class="vb-v">${r.value >= 0 ? '+' : '−'}${Math.abs(r.value).toFixed(2)}</span></div>`;
    }).join('')}</div>`;
  }
  function heatmap(matrix, labels, names) {
    const rowsum = matrix.map((r) => r.reduce((a, b) => a + b, 0));
    return `<div class="hm" style="--n:${labels.length}"><span class="hm-corner">True ↓ · Predicted →</span>${labels.map((l) => `<span class="hm-h">${esc(names[l] || l)}</span>`).join('')}
      ${matrix.map((row, i) => `<span class="hm-h r">${esc(names[labels[i]] || labels[i])}</span>${row.map((n, j) => {
        const share = rowsum[i] ? n / rowsum[i] : 0;
        return `<span class="hm-c${i === j ? ' diag' : ''}" tabindex="0" style="background:rgba(57,135,229,${(0.08 + share * 0.85).toFixed(3)})"
          data-tip="${esc(`${Math.round(share * 100)}% of true ${names[labels[i]] || labels[i]}\npredicted ${names[labels[j]] || labels[j]}: ${n} cases`)}">${Math.round(share * 100)}%</span>`;
      }).join('')}`).join('')}</div>`;
  }
  const tile = (v, k) => `<div class="tile"><span class="v">${v}</span><span class="k">${k}</span></div>`;

  // percentile of value v in a 101-point quantile table
  function percentileOf(q, v) {
    if (v <= q[0]) return 0;
    if (v >= q[100]) return 100;
    for (let i = 1; i <= 100; i++) if (v <= q[i]) return i - 1 + (q[i] === q[i - 1] ? 0.5 : (v - q[i - 1]) / (q[i] - q[i - 1]));
    return 100;
  }

  // ------------------------------------------------------------------ the AI Lab page
  const C1 = 'var(--viz-1)', C2 = 'var(--viz-2)';
  function render(root, D, players, ctx) {
    const has = players.length > 0;
    const section = (id, title, sub, body) => `<section class="lab-s" id="${id}"><h2>${title}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}${body}</section>`;

    // 1. every model vs its baseline
    const scoreboard = D.comparison.map((t) => {
      // bars always start at zero; the labels carry small differences (sumo log losses differ in the 3rd decimal)
      const rows = t.rows.map((r) => ({ label: r.model.replace('Baseline: ', 'Baseline · '), value: r.value,
        valueText: t.metric === 'Log loss' ? r.value.toFixed(4) : r.value < 2 ? r.value.toFixed(3) : r.value.toFixed(1),
        color: r.kind === 'chosen' ? C1 : r.kind === 'baseline' ? 'var(--viz-base)' : 'var(--viz-cand)', strong: r.kind === 'chosen',
        tip: `${r.value}\n${r.model}${r.kind === 'chosen' ? ' (chosen)' : ''}` }));
      return `<div class="lab-card"><div class="lab-card-h"><b>${esc(t.title)}</b><span class="muted tiny">${esc(t.metric)} · ${t.lower_is_better ? 'lower is better ↓' : 'higher is better ↑'}</span></div>${hbars(rows, { stack: true })}</div>`;
    }).join('');

    // 2. ROC + calibration (deployed skill model on unseen 2024+ fights)
    const sk = D.skill;
    const report = D.comparison.find((t) => t.task === 'skill').rows.find((r) => r.kind === 'chosen').value;
    const roc = lineChart({ aria: 'ROC curve of the skill model', series: [{ name: 'Skill model', color: C1, pts: sk.roc }], area: true, ref: [[0, 0], [1, 1]],
      x: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => v.toFixed(2), label: 'False positive rate' },
      y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v) => v.toFixed(2), label: 'True positive rate' },
      tip: (i) => [`TPR ${sk.roc[i][1].toFixed(2)} · FPR ${sk.roc[i][0].toFixed(2)}`, `finds ${pct(sk.roc[i][1])} of winners`, `while wrongly flagging ${pct(sk.roc[i][0])} of losers`] });
    const cal = lineChart({ aria: 'Calibration of the skill model', series: [{ name: 'Observed', color: C1, dots: true, pts: sk.calibration.map((c) => [c.p, c.observed]) }], ref: [[0, 0], [1, 1]],
      x: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: pct, label: 'Predicted chance (red corner wins)' },
      y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: pct, label: 'Observed win rate' },
      tip: (i) => [`said ${pct(sk.calibration[i].p)} → happened ${pct(sk.calibration[i].observed)}`, `${sk.calibration[i].n} fights in this bin`] });

    // 3. feature importance (permutation) for each model
    const num = (d, unit = '') => (v) => { const r = Number(v.toFixed(d)); return `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}${unit}`; };
    const IMP = {
      skill: ['Who wins', sk.importance, sk.importance_metric, num(3)],
      method: ['Finish', D.method.importance, D.method.importance_metric, num(3)],
      fitness: ['Fitness class', D.fitness.importance, D.fitness.importance_metric, num(3)],
      grip: ['Grip', D.fitness.grip_importance, D.fitness.grip_importance_metric, num(2, ' kg')],
      strength: ['Strength', D.strength.importance, D.strength.importance_metric, num(1, ' kg')],
    };
    const impBody = (key) => {
      const [, rows, metric, fmt] = IMP[key];
      return `<p class="tiny muted">${esc(metric)} (test set, 5–8 shuffles each).</p>${hbars(rows.map((r) => ({ label: r.label, value: r.value, valueText: fmt(r.value),
        color: r.value > 0 ? C1 : 'var(--viz-base)', tip: `${fmt(r.value)} ± ${fmt(r.sd)}\n${r.label}${r.value <= 0 ? '\nnot needed: other features carry this' : ''}` })))}`;
    };
    const impSeg = `<div class="seg" id="imp-seg">${Object.entries(IMP).map(([k, [t]], i) => `<button type="button" data-k="${k}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>`;

    // 4. coefficients, 5. confusion matrices
    const coefs = divbars(sk.coefficients.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).map((c) => ({ label: c.label, value: c.value,
      tip: `${c.value >= 0 ? '+' : '−'}${Math.abs(c.value).toFixed(3)} log-odds per 1 SD\n${c.label}: ${c.value >= 0 ? 'helps' : 'hurts'} the fighter who has more of it` })));
    const NAMES = { DEC: 'Decision', KO: 'KO / TKO', SUB: 'Submission', A: 'A', B: 'B', C: 'C', D: 'D' };

    // 6. strength + size curves
    const st = D.strength;
    const sMarks = players.map((p) => ({ x: Math.min(160, Math.max(45, p.weight)), y: Math.min(800, Math.max(200, p.strength_index)), label: p.name, color: ctx.colorOf(p.id),
      tip: `${Math.round(p.strength_index)} kg estimated total\n${p.name} · ${p.weight} kg, age ${p.age}` }));
    const strength = lineChart({ aria: 'Predicted strength by bodyweight', series: [{ name: 'Men', color: C1, pts: st.grid.map((w, i) => [w, st.curve.M[i]]) },
      { name: 'Women', color: C2, pts: st.grid.map((w, i) => [w, st.curve.F[i]]) }], marks: sMarks,
      x: { min: 45, max: 160, ticks: [50, 75, 100, 125, 150], fmt: (v) => `${v}`, label: 'Bodyweight (kg), age 28' },
      y: { min: 200, max: 800, ticks: [200, 400, 600, 800], fmt: (v) => `${v}`, label: 'Powerlifting total (kg)' },
      tip: (i) => [`${st.grid[i]} kg bodyweight`, `Men: ${st.curve.M[i]} kg`, `Women: ${st.curve.F[i]} kg`] });
    const sz = D.size;
    const size = lineChart({ aria: 'Chance to beat a 70 kg man by bodyweight', series: [{ name: 'Win chance', color: C1, pts: sz.grid.map((w, i) => [w, sz.p_vs_70kg_man[i]]) }],
      ref: [[50, 0.5], [130, 0.5]], marks: [{ x: 70, y: 0.5, label: '70 kg: 50%' }],
      x: { min: 50, max: 130, ticks: [50, 70, 90, 110, 130], fmt: (v) => `${v}`, label: 'Your bodyweight (kg), man, age 28' },
      y: { min: 0.2, max: 0.9, ticks: [0.3, 0.5, 0.7, 0.9], fmt: pct, label: 'Chance vs a 70 kg man' },
      tip: (i) => [`${pct(sz.p_vs_70kg_man[i])} win chance`, `${sz.grid[i]} kg vs 70 kg, everything else equal`] });
    const ageC = lineChart({ aria: 'Strength by age', series: [{ name: 'Man, 90 kg', color: C1, pts: st.ages.map((a, i) => [a, st.age_curve_m90[i]]) }],
      x: { min: 18, max: 70, ticks: [20, 30, 40, 50, 60, 70], fmt: (v) => `${v}`, label: 'Age (years)' },
      y: { min: 350, max: 650, ticks: [400, 500, 600], fmt: (v) => `${v}`, label: 'Total (kg)' },
      tip: (i) => [`${st.age_curve_m90[i]} kg`, `age ${st.ages[i]}, man 90 kg`] });

    // 7. where you stand, 8. k-NN twins (room players only)
    const stand = has ? players.map((p) => {
      const sP = percentileOf(st.quantiles[p.sex], p.strength_index), rP = percentileOf(D.reach.quantiles[p.sex], p.reach);
      const who = p.sex === 'F' ? 'women' : 'men';
      return `<div class="stand-row">${ctx.av(p.id, 34)}<div class="grow"><b>${esc(p.name)}</b>
        ${hbars([{ label: 'Strength', value: sP, valueText: `${Math.round(sP)}%`, color: C1, tip: `stronger than ${Math.round(sP)}% of ${st.counts[p.sex].toLocaleString()} ${who} in OpenPowerlifting\nestimated total ${Math.round(p.strength_index)} kg` },
          { label: 'Reach', value: rP, valueText: `${Math.round(rP)}%`, color: C1, tip: `longer reach than ${Math.round(rP)}% of UFC ${who}\nestimated reach ${Math.round(p.reach)} cm` }], { max: 100 })}</div></div>`;
    }).join('') : '<p class="muted small">Open the AI Lab from a room to see every player here.</p>';
    const twins = has ? players.map((p) => {
      const t = (p.twins || [])[0];
      if (!t) return '';
      const mine = [p.skill_pct.str_vol, p.skill_pct.str_acc, p.skill_pct.td_vol, p.skill_pct.td_acc, p.skill_pct.sub, p.height, p.weight];
      const fmt = (v, k) => (k < 5 ? `${Math.round(v * 100)}` : `${Math.round(v)}`);
      const keys = ['Strike vol', 'Strike acc', 'TD vol', 'TD acc', 'Subs', 'Height', 'Weight'];
      return `<details class="twin"><summary>${ctx.av(p.id, 34)}<span class="grow"><b>${esc(p.name)}</b> → ${esc(t.name)}<br><span class="muted tiny">${esc(t.weight_class)} · record ${esc(t.record)} · last UFC fight ${t.year}</span></span><span class="num">${t.match}%</span></summary>
        <table class="tape"><tr><th></th><th>${esc(p.name)}</th><th>${esc(t.name)}</th></tr>${keys.map((k, i) => `<tr><td class="k">${k}${i < 5 ? ' %ile' : i === 5 ? ' cm' : ' kg'}</td><td>${fmt(mine[i], i)}</td><td>${fmt(t.x[i], i)}</td></tr>`).join('')}</table>
        <p class="tiny muted">Next closest: ${(p.twins || []).slice(1).map((x) => `${esc(x.name)} (${x.match}%)`).join(', ')}. Distance ${t.distance} (z-score units).</p></details>`;
    }).join('') : '<p class="muted small">Open the AI Lab from a room to find every player\'s UFC twin.</p>';

    root.innerHTML = `
      <h1>AI <span class="pop">Lab</span></h1>
      <p class="muted">How the six models behave on data they never saw during training. Every chart is computed from the trained models (${esc(D.models_trained_at.slice(0, 10))}).</p>
      ${has ? `<p class="small"><a class="link" href="/r/${esc(ctx.code)}">← Back to room ${esc(ctx.code)}</a></p>` : ''}
      <div class="tiles">${tile('5', 'datasets')}${tile('1.5M+', 'records')}${tile('6', 'models')}${tile(sk.auc.toFixed(2), 'AUC who wins')}</div>
      <nav class="lab-nav">${[['score', 'Scores'], ['roc', 'ROC'], ['imp', 'Importance'], ['xai', 'XAI'], ['curves', 'Curves'], ['cm', 'Confusion'], ['you', 'You'], ['knn', 'k-NN']].map(([k, t]) => `<a href="#${k}">${t}</a>`).join('')}</nav>
      ${section('score', 'Every model vs its baseline', 'Held-out test data: UFC 2024+, sumo 2022+, 20% of people never trained on. Blue = the model the game uses.', `<div class="lab-grid">${scoreboard}</div>`)}
      ${section('roc', 'Who wins: ROC curve and calibration', `Deployed skill model on ${sk.n.toLocaleString()} UFC fights from 2024+ (never seen: trained on fights up to 2023). AUC ${sk.auc.toFixed(3)}. During model selection, trained only up to 2021, it scored ${report.toFixed(3)}.`,
        `<div class="lab-card"><div class="lab-card-h"><b>ROC curve</b><span class="muted tiny">AUC ${sk.auc.toFixed(3)} · diagonal = coin flip</span></div>${roc}</div>
         <div class="lab-card"><div class="lab-card-h"><b>Calibration</b><span class="muted tiny">on the diagonal = honest probabilities</span></div>${cal}
         <p class="tiny muted">When the model says 70%, the favourite should win about 7 fights in 10. Here the points are steeper than the diagonal: the model is
         <b>under-confident</b>. When it says ${pct(sk.calibration.at(-1).p)}, the favourite actually wins about ${pct(sk.calibration.at(-1).observed)}. Strong L2 regularisation (C = 0.03) pulls every chance toward 50%, so the game's upsets are, if anything, a little too frequent. This is safer than over-confidence.</p></div>`)}
      ${section('imp', 'What each model relies on', 'Permutation importance: shuffle one feature in the test set and measure how much worse the model gets. Bigger bar = the model needs that feature more.',
        `${impSeg}<div class="lab-card" id="imp-body">${impBody('skill')}</div>`)}
      ${section('xai', 'Explainable AI', 'The win formula is additive in log-odds, so every prediction can be split into exact parts.',
        `<div class="lab-card formula"><code>logit P(A wins) = skill(A − B) + β · log(Strength_A / Strength_B)</code>
          <p class="small">β = ${sz.beta.toFixed(2)} = ${sz.beta_sumo} (386K sumo bouts) × ${sz.scale} (ADCC open weight, 95% CI ${sz.scale_ci[0]}–${sz.scale_ci[1]}).</p></div>
         <div class="lab-card"><b>1 · Local explanation: SHAP waterfall</b><p class="small muted">For a linear model the SHAP value of a feature is exactly coefficient × (A − B), measured from an equal opponent. Every fight shows this waterfall: from 50% to the final chance, one factor at a time.</p></div>
         <div class="lab-card"><b>2 · Counterfactual: “What if…?”</b><p class="small muted">Change one answer (5 kg more, 10 more push-ups, wrestling level 3) and the same trained models are re-run. It answers “what would I need to change to win?”.</p></div>
         <div class="lab-card"><b>3 · Global explanation: coefficients</b><p class="small muted">Effect of a 1-SD advantage on the log-odds of winning a UFC fight. Blue helps, red hurts.</p>${coefs}</div>`)}
      ${section('curves', 'What the models learned', '',
        `<div class="lab-card"><div class="lab-card-h"><b>Strength grows slower than bodyweight</b><span class="muted tiny">${st.n.toLocaleString()} lifters</span></div>${strength}
          ${has ? '<p class="tiny muted">Dots: players in this room (strength after the push-up test).</p>' : ''}</div>
         <div class="lab-card"><div class="lab-card-h"><b>Strength peaks around 30</b><span class="muted tiny">man, 90 kg</span></div>${ageC}</div>
         <div class="lab-card"><div class="lab-card-h"><b>Bigger helps, but less and less</b><span class="muted tiny">β = ${sz.beta.toFixed(2)}</span></div>${size}</div>`)}
      ${section('cm', 'Where the classifiers go wrong', 'Confusion matrices on the test set, as a share of each true class. The diagonal is correct.',
        `<div class="lab-card"><div class="lab-card-h"><b>Fitness class A–D</b><span class="muted tiny">${D.fitness.n.toLocaleString()} people</span></div>${heatmap(D.fitness.confusion, D.fitness.classes, NAMES)}
          <p class="tiny muted">The extremes are easiest: A (81%) and D (65%). The middle classes B and C are mixed up most, and most mistakes land one class away.</p></div>
         <div class="lab-card"><div class="lab-card-h"><b>Finish method</b><span class="muted tiny">${D.method.n.toLocaleString()} UFC fights 2024+</span></div>${heatmap(D.method.confusion, D.method.classes, NAMES)}
          <p class="tiny muted">Decision is the most common ending (half of all fights), so the top guess is usually “decision”, and most KOs and submissions are called that too. This is why the game rolls the finish from the probabilities instead of always taking the top guess.</p></div>`)}
      ${section('you', 'Where you stand in the data', `Percentile among ${st.counts.M.toLocaleString()} men / ${st.counts.F.toLocaleString()} women in OpenPowerlifting and ${D.reach.n.toLocaleString()} UFC fighters.`, stand)}
      ${section('knn', 'Your UFC twin (k-nearest neighbours)', 'k-NN needs no training: it compares you with every UFC fighter of your sex on 7 features (5 style percentiles, height, weight), standardised to z-scores, and returns the closest 3 by Euclidean distance. Match = 1 / (1 + distance).', twins)}`;

    const seg = document.getElementById('imp-seg');
    seg.querySelectorAll('button').forEach((b) => b.onclick = () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById('imp-body').innerHTML = impBody(b.dataset.k);
    });
  }

  window.Viz = { waterfall, lineChart, hbars, percentileOf, FACTOR };
  window.Lab = { render };
})();
