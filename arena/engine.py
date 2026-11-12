"""Game engine: turns what a player can answer into model inputs, then predicts and explains fights.

Win probability for A vs B (logit scale; every part is additive, so it can be explained):

    logit = skill(A - B)                          UFC model: striking, wrestling, grappling, experience,
                                                  reach, age, stance (trained skills x SKILL_BOOST)
          + beta * log(Strength_A / Strength_B)   sumo size model, rescaled on ADCC open-weight matches

    Strength = powerlifting model(sex, age, bodyweight) * fitness multiplier
    fitness multiplier = grip predicted WITH the player's fitness / grip predicted WITHOUT it

Players report max push-ups. Push-ups -> percentile for their age and sex (CSEP norms) -> the
equivalent sit-ups and broad jump from the Body Performance data -> the trained fitness models.

Each factor is explained on its own: the win chance if two fighters were equal in everything else.
"""
import math
import random
from functools import lru_cache

import joblib
import numpy as np

from arena.paths import MODEL_FILE

# Self-rated level (0-5) -> percentile among UFC fighters for that skill. Assumption, documented
# in the report: a level describes how someone ranks, so it maps onto the pro distribution's ranks.
LEVEL_PERCENTILE = [0.03, 0.15, 0.35, 0.55, 0.75, 0.92]
LEVEL_NAMES = ['Never trained', 'Tried it', 'Train regularly', '2+ years, spar hard', 'Competitor', 'Pro level']
LEVELS = {'striking': LEVEL_NAMES, 'wrestling': LEVEL_NAMES, 'grappling': LEVEL_NAMES}

# Design assumption (documented in the report): the skill model learned from UFC pros, who are all
# trained, so it underrates the gap between trained and untrained people. Trained-skill
# contributions are therefore doubled. Reach, age, stance, size and strength stay as learned.
SKILL_BOOST = 2.0
BOOSTED_GROUPS = ('striking', 'wrestling', 'grappling', 'experience')

GROUPS = {'str_vol': 'striking', 'str_acc': 'striking', 'td_vol': 'wrestling', 'td_acc': 'wrestling',
          'sub': 'grappling', 'exp': 'experience', 'height': 'reach', 'reach': 'reach', 'age': 'age',
          'southpaw': 'stance'}
GROUP_ORDER = ['size', 'strength', 'striking', 'wrestling', 'grappling', 'experience', 'reach', 'age', 'stance']
GROUP_INFO = {
    'size': ('⚖️', 'Body size'), 'strength': ('💪', 'Strength & fitness'), 'striking': ('🥊', 'Striking'),
    'wrestling': ('🤼', 'Wrestling'), 'grappling': ('🥋', 'Grappling'), 'experience': ('🎖️', 'Experience'),
    'reach': ('📏', 'Reach & height'), 'age': ('🎂', 'Age'), 'stance': ('🔄', 'Stance'),
}
REF_SEX, REF_AGE = 1.0, 28.0

# CSEP push-up norms (CSEP-PATH Resource Manual, 2nd ed., 2019; reprinted by ACE). Lower bound of
# Fair / Good / Very good / Excellent by age group. Men: full push-ups; women: knee push-ups.
# The five categories are treated as quintiles (20th, 40th, 60th, 80th percentile boundaries).
PUSHUP_NORMS = {
    'M': {15: (18, 23, 29, 39), 20: (17, 22, 29, 36), 30: (12, 17, 22, 30), 40: (10, 13, 17, 25),
          50: (7, 10, 13, 21), 60: (5, 8, 11, 18)},
    'F': {15: (12, 18, 25, 33), 20: (10, 15, 21, 30), 30: (8, 13, 20, 27), 40: (5, 11, 15, 24),
          50: (2, 7, 11, 21), 60: (2, 5, 12, 17)},
}
PUSHUP_RATINGS = ['Needs work', 'Fair', 'Good', 'Very good', 'Excellent']


@lru_cache(maxsize=1)
def load_models():
    return joblib.load(MODEL_FILE)


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


# ----------------------------------------------------------------------------- player profile

def pushup_percentile(sex, age, pushups):
    """Push-ups -> (percentile 0..1, rating) for this sex and age, from the CSEP norm table."""
    groups = sorted(PUSHUP_NORMS[sex])
    group = max([g for g in groups if g <= max(age, 15)] or [15])
    fair, good, very_good, excellent = PUSHUP_NORMS[sex][group]
    knots_x = [0, fair, good, very_good, excellent, excellent * 1.6]
    knots_p = [0.02, 0.20, 0.40, 0.60, 0.80, 0.97]
    pct = float(np.clip(np.interp(pushups, knots_x, knots_p), 0.01, 0.99))
    rating = PUSHUP_RATINGS[sum(pushups >= cut for cut in (fair, good, very_good, excellent))]
    return pct, rating


def equivalent_tests(models, sex, age, pct):
    """Sit-ups and broad jump at the same percentile for people of this sex and age band."""
    bands = models['fitness_quantiles'][sex]
    age = float(np.clip(age, 21, 64))
    label = next(b for b in bands if int(b.split('-')[0]) <= age <= int(b.split('-')[1]))
    q = int(round(pct * 100))
    return bands[label]['situps'][q], bands[label]['jump'][q]


def experience_percentile(levels):
    """No separate question: a player's best skill says most about how much they have trained."""
    pcts = [LEVEL_PERCENTILE[v] for v in levels.values()]
    return 0.6 * max(pcts) + 0.4 * sum(pcts) / len(pcts)


def strength_kg(models, sex_m, age, weight):
    """Powerlifting-model estimate of maximal strength (used only as a ratio between players)."""
    X = np.array([[sex_m, float(np.clip(age, 16, 70)), math.log(float(np.clip(weight, 40, 200)))]])
    return float(math.exp(models['strength'].predict(X)[0]))


def derive(profile):
    """Everything the models need, plus friendly numbers to show the player."""
    models = load_models()
    sex_m = 1.0 if profile['sex'] == 'M' else 0.0
    age, height, weight = float(profile['age']), float(profile['height']), float(profile['weight'])
    reach = float(models['reach'].predict(np.array([[height, weight, sex_m]]))[0])

    pushups = profile.get('pushups')
    fitness, multiplier, pushup_info = None, 1.0, None
    if pushups is not None:
        pct, rating = pushup_percentile(profile['sex'], age, int(pushups))
        situps, jump = equivalent_tests(models, profile['sex'], age, pct)
        body = [sex_m, float(np.clip(age, 21, 64)), height, weight]
        full = np.array([body + [situps, jump]])
        grip_with = float(models['grip_full'].predict(full)[0])
        grip_without = float(models['grip_base'].predict(np.array([body]))[0])
        multiplier = float(np.clip(grip_with / max(grip_without, 1.0), 0.75, 1.3))
        proba = models['fitness_class'].predict_proba(full)[0]
        classes = list(models['fitness_class'].classes_)
        fitness = {'class': classes[int(np.argmax(proba))], 'grip_kg': round(grip_with, 1),
                   'proba': {c: round(float(p), 3) for c, p in zip(classes, proba)}}
        pushup_info = {'count': int(pushups), 'percentile': round(pct, 3), 'rating': rating}

    levels = {k: int(profile[k]) for k in ('striking', 'wrestling', 'grappling')}
    skill = {
        'str_vol': LEVEL_PERCENTILE[levels['striking']], 'str_acc': LEVEL_PERCENTILE[levels['striking']],
        'td_vol': LEVEL_PERCENTILE[levels['wrestling']], 'td_acc': LEVEL_PERCENTILE[levels['wrestling']],
        'sub': LEVEL_PERCENTILE[levels['grappling']], 'exp': experience_percentile(levels),
        'height': height, 'reach': reach, 'age': age,
        'southpaw': 1.0 if profile.get('hand') == 'left' else 0.0,
    }
    return {
        'reach_cm': round(reach, 1),
        'strength_index': round(strength_kg(models, sex_m, age, weight) * multiplier, 1),
        'size_strength_ref': strength_kg(models, REF_SEX, REF_AGE, weight),
        'fitness_multiplier': round(multiplier, 3),
        'fitness': fitness,
        'pushups': pushup_info,
        'skill': skill,
        'style': style_label(levels),
    }


def style_label(levels):
    top = max(levels.values())
    if top <= 1:
        return 'Brawler'
    best = [k for k, v in levels.items() if v == top]
    if len(best) > 1:
        return 'All-rounder'
    return {'striking': 'Striker', 'wrestling': 'Wrestler', 'grappling': 'Submission artist'}[best[0]]


# ----------------------------------------------------------------------------- one matchup

def matchup(a, b):
    """P(a beats b) with each factor's contribution in logit units (positive helps a)."""
    models = load_models()
    skill = models['skill']
    contrib = {g: 0.0 for g in GROUP_ORDER}
    for feature, coef in zip(skill['features'], skill['coef']):
        boost = SKILL_BOOST if GROUPS[feature] in BOOSTED_GROUPS else 1.0
        contrib[GROUPS[feature]] += boost * coef * (a['derived']['skill'][feature] - b['derived']['skill'][feature])
    beta = models['size']['beta']
    if models['size']['feature'] == 'log_strength_ratio':
        total_size = beta * math.log(a['derived']['strength_index'] / b['derived']['strength_index'])
        body_size = beta * math.log(a['derived']['size_strength_ref'] / b['derived']['size_strength_ref'])
    else:  # size model trained on plain weight ratio
        total_size = body_size = beta * math.log(a['profile']['weight'] / b['profile']['weight'])
    contrib['size'] = body_size
    contrib['strength'] = total_size - body_size
    logit = sum(contrib.values())
    return {'p': sigmoid(logit), 'logit': logit, 'contrib': contrib}


def factor_points(result):
    """Each factor on its own, as A's edge over a coin flip in percentage points: the chance A would
    have if the two were equal in everything except this factor, minus 50%. Easy to read at any odds."""
    return {g: 100.0 * (sigmoid(c) - 0.5) for g, c in result['contrib'].items()}


def describe_factor(group, fav, other):
    """Plain-language reason with the real numbers behind it."""
    fp, op = fav['profile'], other['profile']
    fd, od = fav['derived'], other['derived']
    f, o = fav['name'], other['name']
    if group == 'size':
        return f"{f} is {abs(fp['weight'] - op['weight']):.0f} kg heavier ({fp['weight']:.0f} vs {op['weight']:.0f} kg). Bigger bodies hit and hold harder."
    if group == 'strength':
        ratio = (fd['strength_index'] / fd['size_strength_ref']) / (od['strength_index'] / od['size_strength_ref'])
        why = []
        if fp['sex'] != op['sex']:
            why.append('men are stronger on average at the same weight')
        if fd['pushups'] and (not od['pushups'] or fd['fitness_multiplier'] > od['fitness_multiplier']):
            why.append(f"{fd['pushups']['count']} push-ups ({fd['pushups']['rating'].lower()} for their age)")
        if abs(fp['age'] - op['age']) >= 8:
            why.append('strength peaks around 25-35')
        return f"{f} is about {abs(ratio - 1) * 100:.0f}% stronger for their size" + (f": {'; '.join(why)}." if why else '.')
    if group in ('striking', 'wrestling', 'grappling'):
        fl, ol = fp[group], op[group]
        return f"{group.capitalize()}: {f} is level {fl} ({LEVEL_NAMES[fl].lower()}) vs {o} at level {ol} ({LEVEL_NAMES[ol].lower()})."
    if group == 'experience':
        return f"{f} has more overall fight training (best skill level {max(fp['striking'], fp['wrestling'], fp['grappling'])} vs {max(op['striking'], op['wrestling'], op['grappling'])})."
    if group == 'reach':
        return f"{f}'s reach is about {abs(fd['reach_cm'] - od['reach_cm']):.0f} cm longer ({fd['reach_cm']:.0f} vs {od['reach_cm']:.0f} cm, estimated from height), so they can hit from further away."
    if group == 'age':
        return f"{f} is {abs(fp['age'] - op['age']):.0f} years younger ({fp['age']} vs {op['age']}). In UFC data younger fighters win more often."
    if group == 'stance':
        return f"{f} is left-handed (southpaw stance), which right-handed opponents find awkward."
    return ''


def explain_fight(a, b, result):
    """Everything the UI shows for one fight: factors with numbers, headline, tale of the tape."""
    points = factor_points(result)
    factors = []
    for group in GROUP_ORDER:
        pts = points[group]
        if abs(pts) < 0.5:
            continue
        fav, other = (a, b) if pts > 0 else (b, a)
        icon, label = GROUP_INFO[group]
        factors.append({'group': group, 'icon': icon, 'label': label, 'points_a': round(pts, 1),
                        'favors': 'a' if pts > 0 else 'b', 'text': describe_factor(group, fav, other)})
    factors.sort(key=lambda x: abs(x['points_a']), reverse=True)
    p = result['p']
    fav = a if p >= 0.5 else b
    top = [f['label'].lower() for f in factors if (f['favors'] == 'a') == (fav is a)][:2]
    if abs(p - 0.5) < 0.05:
        headline = f"Coin flip: {a['name']} {p:.0%} vs {b['name']} {1 - p:.0%}. Their advantages cancel out."
    else:
        headline = f"{fav['name']} is favoured ({max(p, 1 - p):.0%})" + (f", mainly because of {' and '.join(top)}." if top else '.')
    return {'headline': headline, 'factors': factors}


# ----------------------------------------------------------------------------- finish method + fight script

def method_probabilities(winner, loser):
    models = load_models()
    keys = ['str_vol', 'str_acc', 'td_vol', 'td_acc', 'sub', 'exp']
    x = np.array([[winner['derived']['skill'][k] for k in keys] + [loser['derived']['skill'][k] for k in keys]])
    proba = models['method'].predict_proba(x)[0]
    return {c: float(p) for c, p in zip(models['method_classes'], proba)}


def finish_reason(winner, loser, method, proba):
    w, l = winner['profile'], loser['profile']
    likely = max(proba, key=proba.get)
    name = {'KO': 'a knockout', 'SUB': 'a submission', 'DEC': 'a decision'}
    base = f"The finish model gave {name[likely]} the best odds ({proba[likely]:.0%})"
    if likely == 'KO':
        base += f": {winner['name']}'s striking (level {w['striking']}) vs {loser['name']}'s defence."
    elif likely == 'SUB':
        base += f": {winner['name']}'s grappling (level {w['grappling']}) and wrestling (level {w['wrestling']})."
    else:
        base += ': neither side has a big finishing weapon, so it likely goes the distance.'
    if method != likely:
        base += f" This time it ended by {name[method]} instead ({proba[method]:.0%} chance)."
    return base


def fight_script(a, b, a_wins, method, p_a, rng):
    """A short sequence of actions for the animation that ends in the predicted finish."""
    winner, loser = ('a', 'b') if a_wins else ('b', 'a')
    fighters = {'a': a, 'b': b}
    hp = {'a': 100.0, 'b': 100.0}
    p_win = p_a if a_wins else 1 - p_a
    rounds = 3 if method == 'DEC' else rng.randint(1, 2)
    events, ground = [], False
    for rnd in range(1, rounds + 1):
        events.append({'type': 'round', 'round': rnd})
        for _ in range(rng.randint(4, 6)):
            # The predicted winner controls more exchanges, more so when the model is confident.
            actor = winner if rng.random() < 0.55 + 0.3 * (p_win - 0.5) else loser
            target = 'b' if actor == 'a' else 'a'
            lv = fighters[actor]['profile']
            if ground:
                options = [('ground_strike', 1 + lv['striking'] + lv['wrestling']),
                           ('sub_attempt', 0.3 + lv['grappling']), ('stand_up', 1.0)]
            else:
                options = [('jab', 1 + lv['striking']), ('cross', 0.8 + lv['striking']),
                           ('kick', 0.4 + lv['striking'] * 0.6), ('takedown', 0.3 + lv['wrestling'])]
            action = rng.choices([o[0] for o in options], weights=[o[1] for o in options])[0]
            landed = rng.random() < (0.65 if actor == winner else 0.45)
            damage = 0.0
            if action in ('jab', 'cross', 'kick', 'ground_strike') and landed:
                damage = {'jab': 5, 'cross': 9, 'kick': 8, 'ground_strike': 7}[action] * rng.uniform(0.7, 1.3)
            if action == 'takedown' and landed:
                ground, damage = True, 3.0
            if action == 'stand_up':
                ground, landed = False, True
            floor = 8.0 if target == winner else (12.0 if method != 'DEC' else 25.0)
            hp[target] = max(floor, hp[target] - damage)
            events.append({'type': 'action', 'actor': actor, 'action': action, 'landed': landed,
                           'ground': ground, 'hp': {k: round(v) for k, v in hp.items()}})
    if method == 'KO':
        events.append({'type': 'action', 'actor': winner, 'action': 'cross', 'landed': True, 'ground': False,
                       'hp': {winner: round(hp[winner]), loser: 0}})
        events.append({'type': 'finish', 'method': 'KO', 'winner': winner})
    elif method == 'SUB':
        events.append({'type': 'action', 'actor': winner, 'action': 'takedown', 'landed': True, 'ground': True,
                       'hp': {k: round(v) for k, v in hp.items()}})
        events.append({'type': 'finish', 'method': 'SUB', 'winner': winner,
                       'hold': rng.choice(['rear-naked choke', 'armbar', 'triangle', 'guillotine', 'kimura'])})
    else:
        events.append({'type': 'finish', 'method': 'DEC', 'winner': winner,
                       'cards': '3-0' if p_win > 0.65 else rng.choice(['2-1', '3-0'])})
    return events


def simulate_fight(a, b, rng, force_winner=None):
    """One fight: winner sampled from the win chance (or forced), finish from the method model."""
    result = matchup(a, b)
    a_wins = (rng.random() < result['p']) if force_winner is None else (force_winner == a['id'])
    winner, loser = (a, b) if a_wins else (b, a)
    methods = method_probabilities(winner, loser)
    method = rng.choices(list(methods), weights=list(methods.values()))[0]
    p_winner = result['p'] if a_wins else 1 - result['p']
    upset = p_winner < 0.5
    return {
        'a': a['id'], 'b': b['id'], 'p_a': round(result['p'], 4), 'winner': winner['id'],
        'method': method, 'method_proba': {k: round(v, 3) for k, v in methods.items()},
        'upset': upset,
        'upset_note': (f"Upset! {winner['name']} had only a {p_winner:.0%} chance: at these odds the underdog "
                       f"wins about 1 fight in {max(2, round(1 / max(p_winner, 0.01)))}. The simulation rolls the dice "
                       f"with the AI's odds, so surprises happen like in real fights." if upset else None),
        'explain': explain_fight(a, b, result),
        'finish_reason': finish_reason(winner, loser, method, methods),
        'script': fight_script(a, b, a_wins, method, result['p'], rng),
    }


# ----------------------------------------------------------------------------- game modes

def prepare(players):
    """Attach model inputs to each player record {'id','name','profile'}. Always recomputed from what the
    player entered, so players saved by an older app version or before a retrain stay consistent."""
    return [dict(p, derived=derive(p['profile'])) for p in players]


def rank_players(players, top_k=3, seed=None):
    """Mode 1: everyone vs everyone, ranked by expected win rate, with reasons and a battle-royale show."""
    if len(players) < 2:
        raise ValueError('a ranking needs at least 2 fighters')
    rng = random.Random(seed)
    players = prepare(players)
    n = len(players)
    res = {}
    for i in range(n):
        for j in range(i + 1, n):
            m = matchup(players[i], players[j])
            res[(i, j)] = m
            res[(j, i)] = {'p': 1 - m['p'], 'logit': -m['logit'], 'contrib': {g: -v for g, v in m['contrib'].items()}}

    table = []
    for i, player in enumerate(players):
        opponents = [j for j in range(n) if j != i]
        win_rate = float(np.mean([res[(i, j)]['p'] for j in opponents]))
        pts = {g: float(np.mean([factor_points(res[(i, j)])[g] for j in opponents])) for g in GROUP_ORDER}
        hardest = min(opponents, key=lambda j: res[(i, j)]['p'])
        easiest = max(opponents, key=lambda j: res[(i, j)]['p'])
        reasons = []
        for g, v in sorted(pts.items(), key=lambda kv: -abs(kv[1])):
            if abs(v) < 0.5:
                continue
            icon, label = GROUP_INFO[g]
            reasons.append({'group': g, 'icon': icon, 'label': label, 'points': round(v, 1),
                            'text': group_reason(g, player, [players[j] for j in opponents], v)})
        table.append({'id': player['id'], 'name': player['name'], 'win_rate': round(win_rate, 4),
                      'style': player['derived']['style'], 'reasons': reasons[:5],
                      'hardest': {'id': players[hardest]['id'], 'name': players[hardest]['name'],
                                  'p': round(res[(i, hardest)]['p'], 3)},
                      'easiest': {'id': players[easiest]['id'], 'name': players[easiest]['name'],
                                  'p': round(res[(i, easiest)]['p'], 3)}})
    table.sort(key=lambda r: r['win_rate'], reverse=True)
    for place, row in enumerate(table, start=1):
        row['place'] = place
        row['why'] = explain_place(row, place)

    order = [r['id'] for r in table]
    index = {p['id']: i for i, p in enumerate(players)}
    matrix = [[None if a == b else round(res[(index[a], index[b])]['p'], 3) for b in order] for a in order]
    return {'mode': 'ranking', 'top_k': min(top_k, n), 'table': table,
            'matrix': {'ids': order, 'p': matrix},
            'show': battle_royale(players, order, res, index, rng)}


def group_reason(group, player, opponents, points):
    """Short reason for a ranking card, comparing the player with the group average."""
    p, d = player['profile'], player['derived']
    avg = lambda f: sum(f(o) for o in opponents) / len(opponents)  # noqa: E731
    if group == 'size':
        diff = p['weight'] - avg(lambda o: o['profile']['weight'])
        return f"{abs(diff):.0f} kg {'heavier' if diff > 0 else 'lighter'} than the group average"
    if group == 'strength':
        rel = d['strength_index'] / d['size_strength_ref']
        diff = rel / avg(lambda o: o['derived']['strength_index'] / o['derived']['size_strength_ref']) - 1
        extra = f", {d['pushups']['count']} push-ups ({d['pushups']['rating'].lower()})" if d['pushups'] else ''
        return f"{abs(diff) * 100:.0f}% {'stronger' if diff > 0 else 'weaker'} for their size than average{extra}"
    if group in ('striking', 'wrestling', 'grappling'):
        return f"level {p[group]} ({LEVEL_NAMES[p[group]].lower()}) vs group average {avg(lambda o: o['profile'][group]):.1f}"
    if group == 'experience':
        return 'more overall training than most of the group' if points > 0 else 'less overall training than most of the group'
    if group == 'reach':
        diff = d['reach_cm'] - avg(lambda o: o['derived']['reach_cm'])
        return f"reach {abs(diff):.0f} cm {'longer' if diff > 0 else 'shorter'} than average"
    if group == 'age':
        diff = p['age'] - avg(lambda o: o['profile']['age'])
        return f"{abs(diff):.0f} years {'younger' if diff < 0 else 'older'} than average"
    if group == 'stance':
        return 'southpaw (left-handed) stance' if points > 0 else 'facing southpaws'
    return ''


def explain_place(row, place):
    plus = [r for r in row['reasons'] if r['points'] > 0][:2]
    minus = [r for r in row['reasons'] if r['points'] < 0][:1]
    text = f"Wins {row['win_rate']:.0%} of fights against this group on average"
    text += f", mainly thanks to {' and '.join(r['label'].lower() for r in plus)}." if plus else '.'
    if minus:
        text += f" Biggest weakness: {minus[0]['label'].lower()}."
    return text


def battle_royale(players, order, res, index, rng):
    """Everyone on stage. Fighters are knocked out from last place upwards, each by the remaining
    fighter most likely to beat them; the last two (#1 and #2) fight a full final."""
    by_id = {p['id']: p for p in players}
    remaining = list(order)
    eliminations = []
    for victim in reversed(order[2:]):
        remaining.remove(victim)
        attacker = max(remaining, key=lambda a: res[(index[a], index[victim])]['p'])
        w, l = by_id[attacker], by_id[victim]
        methods = method_probabilities(w, l)
        method = rng.choices(list(methods), weights=list(methods.values()))[0]
        result = res[(index[attacker], index[victim])]
        eliminations.append({'victim': victim, 'attacker': attacker, 'method': method,
                             'p': round(result['p'], 3), 'place': order.index(victim) + 1,
                             'reason': explain_fight(w, l, result)['headline']})
    final = simulate_fight(by_id[order[0]], by_id[order[1]], rng, force_winner=order[0]) if len(order) >= 2 else None
    return {'eliminations': eliminations, 'final': final}


def run_tournament(players, seed=None):
    """Mode 2: random single-elimination bracket (byes when the count is not a power of two)."""
    if len(players) < 2:
        raise ValueError('a tournament needs at least 2 fighters')
    rng = random.Random(seed)
    players = prepare(players)
    by_id = {p['id']: p for p in players}
    order = [p['id'] for p in players]
    rng.shuffle(order)
    size = 1
    while size < len(order):
        size *= 2
    # Byes go one per first-round pair, so two empty slots never meet.
    byes, real, slots = size - len(order), iter(order), []
    for i in range(size // 2):
        slots.append(next(real))
        slots.append(None if i < byes else next(real))

    rounds = []
    current = slots
    while len(current) > 1:
        matches, winners = [], []
        for i in range(0, len(current), 2):
            x, y = current[i], current[i + 1]
            if x is None or y is None:
                advancing = x if y is None else y
                matches.append({'a': x, 'b': y, 'bye': True, 'winner': advancing})
                winners.append(advancing)
                continue
            fight = simulate_fight(by_id[x], by_id[y], rng)
            fight['bye'] = False
            matches.append(fight)
            winners.append(fight['winner'])
        rounds.append({'name': round_name(len(current)), 'matches': matches})
        current = winners
    champion = current[0]
    path = [m for r in rounds for m in r['matches'] if not m.get('bye') and champion in (m['a'], m['b'])]
    return {'mode': 'tournament', 'rounds': rounds, 'champion': champion,
            'champion_name': by_id[champion]['name'], 'champion_path': [
                {'opponent': by_id[m['b'] if m['a'] == champion else m['a']]['name'],
                 'p': round(m['p_a'] if m['a'] == champion else 1 - m['p_a'], 3), 'method': m['method'],
                 'upset': m['upset']} for m in path]}


def round_name(entrants):
    return {2: 'Final', 4: 'Semi-finals', 8: 'Quarter-finals'}.get(entrants, f'Round of {entrants}')
