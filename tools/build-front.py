"""Фронт: 140 событий из reference/engine/war_data.py в формат карт — src/data/front.json.

    python3 -I tools/build-front.py

Данные событий (`war_data.py`) — тот же источник, из которого автор собрал docs/front.md и поле «Фронт».
Оригинальный текст эффекта (`src`) берётся дословно из reference/docs/front.md; названия обязаны совпасть.
"""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'reference', 'engine'))
import war_data as W  # noqa: E402

md = open(os.path.join(ROOT, 'reference', 'docs', 'front.md'), encoding='utf-8').read()
rows = re.findall(r'^\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$', md, flags=re.M)
assert len(rows) == len(W.EV) == 140, (len(rows), len(W.EV))

def trait(t):
    """«Участие» — черта в любой степени; «сильное Самолюбие» — только сильная."""
    m = re.match(r'^(?:сильное|сильная|сильный) (.+)$', t)
    return {'char': m.group(1), 'strong': True} if m else {'char': t}

def cond(c):
    k = c[0]
    if k == 'char': return {'char': c[1]}
    if k == 'char!': return {'char': c[1], 'strong': True}
    if k == 'off': return {'has': 'Офицерское звание'}
    if k == 'ideo': return {'ideo': list(c[1])}
    if k == 'pos': return {'pos': [c[1]]}
    if k == 'item': return {'has': c[1]}
    if k == 'tac': return {'tactic': c[1]}
    if k == 'mate': return {'any': [{'has': 'Супруг(а)'}, {'has': 'Партнёр'}]}
    raise ValueError(c)

def nodes(parts, cap7):
    out = []
    for x in parts:
        out.extend(node(x, cap7))
    return out

def node(x, cap7):
    k = x[0]
    if k == 'ph': return [{'add': {'физ': x[1]}}]
    if k == 'ps': return [{'add': {'псих': x[1]}}]
    if k == 'v': return [{'add': {'возм': x[1]}}]
    if k == 'coh': return [{'add': {'Сплочённость': x[1]}}]
    if k == 'st': return [{'add': {x[1]: x[2]}, **({'cap': 7} if cap7 else {})}]
    if k == 'ch': return [{'charStep': x[1]}]
    if k == 'note': return [{'say': x[1]}]
    if k == 'nothing': return []
    if k in ('trump', 'link', 'stig'): return [{'gain': x[1]}]
    if k == 'jr': return [{'flag': x[1]}]
    if k == 'award': return [{'rule': 'награда'}]
    if k == 'front': return [{'rule': 'метка фронта', 'arg': str(x[1])}]
    if k == 'captive': return [{'rule': 'плен'}]
    if k == 'leave': return [{'rule': 'отпуск'}]
    if k == 'prison': return [{'say': 'трибунал'}, {'prison': x[1]}]
    if k == 'rank_lost': return [{'lose': 'Офицерское звание'}]
    if k == 'chk': return [{'check': {'stat': x[1], 'dc': x[2]}, 'success': nodes(x[3], cap7), 'failure': nodes(x[4], cap7)}]
    if k == 'd6': return [{'d6': {(f'{a}' if a == b else f'{a}-{b}'): nodes(ps, cap7) for (a, b), ps in x[1]}}]
    if k == 'opt':
        opts = []
        for label, traits, ps in x[1]:
            o = {'label': label}
            if traits:
                cs = [trait(t) for t in traits]
                o['must'] = cs[0] if len(cs) == 1 else {'any': cs}
            o['then'] = nodes(ps, cap7)
            opts.append(o)
        return [{'choose': opts}]
    if k == 'ifs':
        branches = [(cond(c), nodes(ps, cap7)) for c, ps in x[1]]
        other = nodes(x[2], cap7)
        if len(branches) == 1:
            n = {'if': branches[0][0], 'then': branches[0][1]}
            if other: n['else'] = other
            return [n]
        n = {'cases': [{'if': c, 'then': t} for c, t in branches]}
        if other: n['else'] = other
        return [n]
    raise ValueError(x)

sign = lambda c: ('+' if c > 0 else '−' if c < 0 else '') + str(abs(c))
events, count = [], {}
for e, r in zip(W.EV, rows):
    assert r[1].strip() == e['title'], (r[1], e['title'])
    count[e['cell']] = count.get(e['cell'], 0) + 1
    n = count[e['cell']]
    assert int(r[0]) == n, (e['title'], r[0], n)
    src = r[3].strip()
    cap7 = 'до 7' in src
    ev = {
        'id': f"фронт.{sign(e['cell'])}.{n:02d}", 'cell': e['cell'], 'n': n, 'title': e['title'], 'text': e['flavor'], 'src': src,
        'tags': ['#' + t for t in e['tags']], 'effect': nodes(e['body'], cap7),
    }
    if e['off']: ev['officer'] = nodes(e['off'], cap7)
    events.append(ev)

out = {'cells': [{'cell': c, 'title': t} for c, t, _ in W.CELLS], 'events': events}
with open(os.path.join(ROOT, 'src', 'data', 'front.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write('\n')
print(f'фронт: {len(events)} событий на {len(count)} клетках, со строкой «Офицер» {sum(1 for e in events if "officer" in e)}')
