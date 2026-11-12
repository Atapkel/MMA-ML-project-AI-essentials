"""Behaviour checks for the game engine (needs a trained models/arena_models.joblib)."""
import math
import random

import pytest

from arena import engine


def person(pid, name='X', **kw):
    profile = dict(name=name, sex='M', age=28, height=178, weight=78, hand='right', striking=1, wrestling=1,
                   grappling=1, pushups=None)
    profile.update(kw)
    return {'id': pid, 'name': name, 'profile': profile, 'derived': engine.derive(profile)}


def test_probabilities_are_symmetric_and_explained():
    a = person(1, striking=4, weight=70)
    b = person(2, wrestling=3, weight=95)
    ab, ba = engine.matchup(a, b), engine.matchup(b, a)
    assert ab['p'] + ba['p'] == pytest.approx(1.0)
    assert sum(ab['contrib'].values()) == pytest.approx(ab['logit'])
    assert ab['p'] == pytest.approx(1 / (1 + math.exp(-ab['logit'])))


def test_identical_people_are_even():
    assert engine.matchup(person(1), person(2))['p'] == pytest.approx(0.5)


def test_more_weight_helps_and_more_skill_helps():
    assert engine.matchup(person(1, weight=100), person(2, weight=70))['p'] > 0.5
    assert engine.matchup(person(1, striking=5, wrestling=5, grappling=5), person(2))['p'] > 0.6


def test_pushups_matter():
    strong, weak = person(1, pushups=50), person(2, pushups=5)
    assert strong['derived']['fitness_multiplier'] > weak['derived']['fitness_multiplier']
    assert strong['derived']['pushups']['rating'] == 'Excellent'
    assert weak['derived']['pushups']['rating'] == 'Needs work'
    assert engine.matchup(strong, weak)['contrib']['strength'] > 0


def test_pushup_norms_depend_on_age_and_sex():
    young, _ = engine.pushup_percentile('M', 25, 20)
    older, _ = engine.pushup_percentile('M', 55, 20)
    woman, _ = engine.pushup_percentile('F', 25, 20)
    assert older > young and woman > young


def test_fight_explanations_have_numbers():
    a, b = person(1, 'Ann', weight=95, striking=4), person(2, 'Bob', weight=65, pushups=40)
    exp = engine.explain_fight(a, b, engine.matchup(a, b))
    assert exp['headline'] and exp['factors']
    groups = {f['group'] for f in exp['factors']}
    assert {'size', 'striking'} <= groups
    size = next(f for f in exp['factors'] if f['group'] == 'size')
    assert size['favors'] == 'a' and '30 kg heavier' in size['text']


def test_reach_is_estimated_from_height():
    assert person(1, height=195)['derived']['reach_cm'] > person(2, height=165)['derived']['reach_cm']


def test_ranking_table():
    players = [person(i, f'P{i}', weight=60 + 8 * i, striking=i % 6) for i in range(1, 7)]
    res = engine.rank_players(players, top_k=3, seed=1)
    rates = [r['win_rate'] for r in res['table']]
    assert rates == sorted(rates, reverse=True)
    assert sum(rates) / len(rates) == pytest.approx(0.5, abs=1e-3)  # zero-sum: every fight has one winner (rates rounded)
    assert [r['place'] for r in res['table']] == list(range(1, 7))
    assert all(r['why'] and r['reasons'] for r in res['table'])
    show = res['show']
    assert len(show['eliminations']) == 4  # everyone except #1 and #2 is knocked out on stage
    assert [e['place'] for e in show['eliminations']] == [6, 5, 4, 3]
    assert show['final']['winner'] == res['table'][0]['id']
    assert len(res['matrix']['p']) == 6 and res['matrix']['p'][0][0] is None


@pytest.mark.parametrize('n', [2, 3, 5, 8, 11])
def test_tournament_bracket(n):
    players = [person(i, f'P{i}', weight=60 + 5 * i) for i in range(1, n + 1)]
    res = engine.run_tournament(players, seed=n)
    fights = [m for r in res['rounds'] for m in r['matches'] if not m.get('bye')]
    assert len(fights) == n - 1  # single elimination: everyone but the champion loses once
    assert res['champion'] in {p['id'] for p in players}
    assert res['rounds'][-1]['name'] == 'Final'


def test_fight_script_ends_with_predicted_winner():
    rng = random.Random(3)
    a, b = person(1, 'A', weight=90, striking=4), person(2, 'B')
    for _ in range(20):
        fight = engine.simulate_fight(a, b, rng)
        finish = fight['script'][-1]
        assert finish['type'] == 'finish' and finish['method'] == fight['method']
        assert (finish['winner'] == 'a') == (fight['winner'] == 1)


def test_too_few_players():
    with pytest.raises(ValueError):
        engine.run_tournament([person(1)])
