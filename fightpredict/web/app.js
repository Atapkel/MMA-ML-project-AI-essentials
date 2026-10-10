'use strict';
const $ = id => document.getElementById(id);
let catalog = [], schema = {}, metrics = null;
const state = {a: null, b: null};
const custom = {a: false, b: false};
const physical = ['age', 'height_cm', 'reach_cm', 'weight_kg'];
let running = false;

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The server could not complete the request.');
  return body;
}
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function clearResult() { $('result').hidden = true; $('error').hidden = true; }
function ready() { $('predict').disabled = running || !state.a || !state.b; }
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?'; }
function readFighter(side) {
  const fighter = {...(state[side] || {})};
  fighter.name = $('search-' + side).value.trim();
  fighter.gender = $('gender-' + side).value;
  fighter.weight_class = $('division-' + side).value;
  for (const key of Object.keys(schema)) {
    const text = $(side + '-' + key).value;
    fighter[key] = text === '' ? null : Number(text);
  }
  return fighter;
}
function loadFighter(side, fighter, isCustom=false) {
  state[side] = {...fighter}; custom[side] = isCustom;
  $('search-' + side).value = fighter.name || '';
  $('monogram-' + side).textContent = initials(fighter.name || 'Custom');
  $('meta-' + side).textContent = isCustom ? 'Custom characteristics · editable' : (fighter.weight_class || 'Unknown division') + ' · ' + (fighter.gender === 'FEMALE' ? 'Women' : 'Men');
  $('snapshot-' + side).textContent = isCustom ? 'Manual entry' : 'Pre-bout: ' + fighter.snapshot_date;
  $('gender-' + side).value = fighter.gender || '';
  $('division-' + side).value = fighter.weight_class || '';
  const card = $('fields-' + side).closest('.fighter-card');
  card.querySelector('.snapshot-pill').textContent = isCustom ? 'CUSTOM FIGHTER' : 'HISTORICAL SNAPSHOT';
  for (const [key, spec] of Object.entries(schema)) {
    const value = fighter[key];
    $(side + '-' + key).value = value === null || value === undefined ? '' : Number(value.toFixed(spec.step === 1 ? 0 : 1));
  }
  clearResult(); ready();
}
function markEdited(side) {
  if (state[side]) {
    custom[side] = true;
    state[side].id = ''; state[side].snapshot_date = '';
    $('snapshot-' + side).textContent = 'Edited characteristics';
    $('meta-' + side).textContent = 'Custom characteristics · editable';
    $('fields-' + side).closest('.fighter-card').querySelector('.snapshot-pill').textContent = 'EDITED SNAPSHOT';
  }
  clearResult(); ready();
}
function setupFields() {
  for (const side of ['a', 'b']) {
    for (const [key, spec] of Object.entries(schema)) {
      const field = element('div', undefined, 'field');
      const label = element('label', spec.label); label.htmlFor = side + '-' + key;
      const wrap = element('div', undefined, 'field-box');
      const input = document.createElement('input'); input.id = side + '-' + key; input.type = 'number';
      input.min = spec.min; input.max = spec.max; input.step = spec.step; input.placeholder = '—';
      input.setAttribute('aria-label', spec.label + ', fighter ' + side.toUpperCase() + ', ' + spec.unit);
      input.addEventListener('input', () => markEdited(side));
      wrap.append(input, element('span', spec.unit)); field.append(label, wrap);
      $(physical.includes(key) ? 'fields-' + side : 'performance-' + side).append(field);
    }
    const division = $('division-' + side);
    division.append(new Option('Unspecified', ''));
    for (const cls of [...new Set(catalog.map(f => f.weight_class))].filter(Boolean).sort()) division.append(new Option(cls, cls));
    division.addEventListener('change', () => markEdited(side));
    $('gender-' + side).addEventListener('change', () => markEdited(side));
    $('search-' + side).addEventListener('input', () => {
      const name = $('search-' + side).value.trim();
      const exact = catalog.find(f => f.name.toLowerCase() === name.toLowerCase());
      if (exact) loadFighter(side, exact);
      else if (custom[side]) {
        state[side].name = name;
        $('monogram-' + side).textContent = initials(name);
        clearResult(); ready();
      } else { state[side] = null; clearResult(); ready(); }
    });
    $('manual-' + side).addEventListener('click', () => {
      const current = readFighter(side);
      const name = $('search-' + side).value.trim();
      const blank = {age: 28, height_cm: 178, reach_cm: 180, weight_kg: 70.3, wins: 5, losses: 2,
                     win_streak: 1, lose_streak: 0, striking_accuracy: 48, takedown_accuracy: 35};
      loadFighter(side, {...blank, ...current, name: name || 'Custom fighter ' + side.toUpperCase(), id: '', snapshot_date: ''}, true);
      $('details-' + side).open = true; $('search-' + side).focus();
    });
  }
  for (const fighter of catalog) $('fighter-options').append(new Option(fighter.name, fighter.name));
}
function showTab(tab) {
  $('matchup-view').hidden = tab !== 'matchup'; $('evidence-view').hidden = tab !== 'evidence';
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  window.scrollTo({top: 0, behavior: 'smooth'});
}
function showMetrics() {
  const test = metrics.test;
  $('hero-accuracy').textContent = (test.accuracy * 100).toFixed(1) + '%';
  $('hero-test').textContent = metrics.splits.test.bouts + ' held-out bouts';
  $('model-status').textContent = 'Trained model · online';
  for (const [label, value, note] of [
    ['Test accuracy', (test.accuracy * 100).toFixed(1) + '%', '95% event-bootstrap CI: ' + metrics.test_ci95_event_bootstrap.accuracy.map(v => (100*v).toFixed(1)+'%').join(' – ')],
    ['Test ROC-AUC', test.roc_auc.toFixed(3), 'Chance baseline: 0.500'],
    ['Test F1-score', test.f1.toFixed(3), 'A / original red corner is positive'],
    ['Test Brier score', test.brier.toFixed(3), 'Lower is better · 50/50 baseline: 0.250'],
  ]) {
    const card = element('div', undefined, 'metric-card'); card.append(element('span', label), element('strong', value), element('small', note)); $('metric-cards').append(card);
  }
  const body = $('model-table').querySelector('tbody');
  for (const row of metrics.experiments) {
    const testRow = metrics.test_comparison.find(x => x.model === row.model && !x.calibrated);
    const tr = element('tr', undefined, row.model === metrics.selected_model ? 'selected' : '');
    for (const v of [row.model, row.validation.brier.toFixed(4), (testRow.accuracy*100).toFixed(1)+'%', testRow.roc_auc.toFixed(3)]) tr.append(element('td', v));
    body.append(tr);
  }
  $('selection-detail').textContent = 'Shipped: ' + metrics.selected_model + ' + 2024 logit calibration. Calibrated test Brier: ' + test.brier.toFixed(4) + '. Test red-corner prior baseline: ' + (metrics.baselines.train_red_corner_prior.accuracy*100).toFixed(1) + '% accuracy. Test results do not determine the selection.';
  for (const [name, split] of Object.entries(metrics.splits)) {
    const row = element('div', undefined, 'split'); const text = element('div');
    text.append(element('strong', name[0].toUpperCase()+name.slice(1)), element('span', split.start+' → '+split.end));
    row.append(text, element('strong', split.bouts.toLocaleString()+' bouts')); $('splits').append(row);
  }
  const audit = metrics.audit;
  $('data-description').textContent = audit.usable_bouts.toLocaleString() + ' binary-outcome bouts from ' + audit.date_min + ' to ' + audit.date_max + ', with ' + audit.athletes.toLocaleString() + ' fighter snapshots. TidyTuesday / fightr / UFCStats. ' + audit.resolved_name_aliases + ' aliases resolved using same-date opponents; '+audit.conflicting_outcomes_removed+' conflicting labels and '+audit.unmatched_bouts_removed+' unmatched bouts removed. UFC career records are reconstructed from strictly earlier fights.';
}
function showResult(result) {
  $('result-title').textContent = result.favored === 'Balanced' ? 'A balanced matchup' : (result.favored === 'A' ? result.fighter_a : result.fighter_b) + ' has the statistical edge';
  $('result-model').textContent = result.model + ' · calibrated';
  $('result-a-name').textContent = result.fighter_a; $('result-b-name').textContent = result.fighter_b;
  $('prob-a').textContent = (100*result.probability_a).toFixed(1)+'%'; $('prob-b').textContent = (100*result.probability_b).toFixed(1)+'%';
  $('probability-fill').style.width = (100*result.probability_a)+'%'; $('scope').textContent = result.scope;
  $('effects').replaceChildren();
  for (const effect of result.sensitivity) {
    const row = element('div', undefined, 'effect');
    const positive = effect.effect_percentage_points > 0;
    row.append(element('span', effect.label), element('strong', (positive?'+':'')+effect.effect_percentage_points.toFixed(1)+' pp for A', positive?'positive':'negative'));
    $('effects').append(row);
  }
  if (!result.sensitivity.length) $('effects').append(element('p', 'No observed feature differences. The symmetric model gives an even estimate.', 'explain-copy'));
  $('warnings').replaceChildren();
  for (const warning of result.warnings) $('warnings').append(element('li', warning));
  if (!result.warnings.length) $('warnings').append(element('li', 'No input-range or division warnings were triggered. That does not guarantee this estimate is well calibrated for the matchup.'));
  $('result').hidden = false;
}
async function calculate(scroll=true) {
  if (!state.a || !state.b || running) return;
  running = true; ready(); $('error').hidden = true;
  $('predict').replaceChildren(document.createTextNode('Calculating…'));
  try {
    const result = await request('/api/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fighter_a:readFighter('a'), fighter_b:readFighter('b')})});
    showResult(result);
    if (scroll) $('result').scrollIntoView({behavior:'smooth', block:'start'});
  } catch (error) {
    $('result').hidden = true; $('error').textContent = error.message; $('error').hidden = false;
  } finally {
    running = false; $('predict').replaceChildren(document.createTextNode('Calculate win probability '), element('span', '↗')); ready();
  }
}
async function initialize() {
  try {
    [catalog, schema, metrics] = await Promise.all([request('/api/fighters'),request('/api/schema'),request('/api/metrics')]);
    setupFields(); showMetrics();
    const a = catalog.find(f => f.name === 'Merab Dvalishvili') || catalog.find(f => f.wins >= 5 && f.gender === 'MALE');
    const b = catalog.find(f => f.name === 'Umar Nurmagomedov') || catalog.find(f => f.id !== a.id && f.weight_class === a.weight_class && f.gender === a.gender);
    loadFighter('a', a); loadFighter('b', b); await calculate(false);
  } catch (error) {
    $('model-status').textContent = 'Model unavailable'; $('error').hidden = false;
    $('error').textContent = 'Could not load the trained model. Start python app.py and open http://127.0.0.1:8000. '+error.message;
  }
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => showTab(button.dataset.tab));
$('evidence-link').addEventListener('click', event => {event.preventDefault(); showTab('evidence');});
$('predict').addEventListener('click', () => calculate());
$('swap').addEventListener('click', () => {
  if (!state.a || !state.b || running) return;
  const a=readFighter('a'), b=readFighter('b'), ca=custom.a, cb=custom.b;
  loadFighter('a', b, cb); loadFighter('b', a, ca); calculate(false);
});
initialize();
