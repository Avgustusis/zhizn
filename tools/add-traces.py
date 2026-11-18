"""Общественный след ✊ (18.11): кладёт шаг `{"rule": "след", "arg": канал}` в нужную ветку 58 карт и строку `trace` на карту.

    python3 -I tools/add-traces.py && for d in ...; do npx tsx tools/build-deck.ts ...; done   (см. docs/ENGINE.md, 9г)

Источник — reference/data/soc_cards.py (TRACE: колода, подколода, №, карта, ветка, канал). Ветка читается так:
  «А», «Б» — первый / второй вариант выбора; «успех», «без провала» — успех проверки в этой ветке;
  «d6 4–6», «d6 1–3» — этот исход броска; «диктатуры и национализм» — ветка условия по идеологии;
  «суд», «перекраситься», «Цинизм: отдать 1 возм.» — вариант с таким названием (Цинизм — в ветке полюса);
  «всегда» — в конце карты; «А — Труд; Б — Капитал» — свой канал в каждой ветке.
Повторный запуск сначала убирает старые шаги `след`. Неразобранная ветка — ошибка.
"""
import importlib.util, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('soc_cards', os.path.join(ROOT, 'reference', 'data', 'soc_cards.py'))
SC = importlib.util.module_from_spec(spec); spec.loader.exec_module(SC)
DECKS = os.path.join(ROOT, 'src', 'data', 'decks')
AGE = {'Детство': 'age-childhood', 'Юность': 'age-youth', 'Молодость': 'age-young', 'Зрелость': 'age-mature', 'Старость': 'age-old'}
FILE = lambda d, sub: AGE[sub] if d == 'Возраст' else {'Страна': 'country', 'Культура': 'culture', 'Класс': 'class', 'Смута': 'turmoil'}[d]


def strip(x):
    """Убрать старые шаги «след»."""
    if isinstance(x, list): return [strip(y) for y in x if not (isinstance(y, dict) and y.get('rule') == 'след')]
    if isinstance(x, dict): return {k: strip(v) for k, v in x.items()}
    return x


def walk(nodes, pred):
    """Первый узел (в глубину), для которого pred истинно."""
    for n in nodes:
        if pred(n): return n
        for k in ('then', 'else', 'success', 'failure'):
            if isinstance(n.get(k), list):
                r = walk(n[k], pred)
                if r: return r
        for c in n.get('cases', []):
            r = walk(c['then'], pred)
            if r: return r
        for o in n.get('choose', []):
            r = walk(o['then'], pred)
            if r: return r
        for v in (n.get('d6') or {}).values():
            r = walk(v, pred)
            if r: return r
    return None


def option(nodes, which):
    ch = walk(nodes, lambda n: 'choose' in n)
    if not ch: raise ValueError('нет выбора')
    opts = ch['choose']
    if which in ('А', 'Б'): return opts['АБВ'.index(which)]['then']
    hit = [o for o in opts if o['label'].startswith(which)]
    if not hit: raise ValueError('нет варианта «%s»' % which)
    return hit


def success(nodes):
    chk = walk(nodes, lambda n: 'check' in n)
    if not chk: raise ValueError('нет проверки')
    return chk['success']


def place(card, br, ch):
    step = lambda c: {'rule': 'след', 'arg': c}
    eff = card['sides']['lose'] if card['id'].startswith('смута.') else card['effect']
    parts = [x.strip() for x in br.split(',')]
    if br == 'всегда': eff.append(step(ch)); return
    if br.startswith('А — '):
        for letter, c in (('А', 'Труд'), ('Б', 'Капитал')): option(eff, letter).append(step(c))
        return
    if br.startswith('Цинизм'):
        pole = walk(eff, lambda n: n.get('if') == {'culture': 'Цинизм'})
        option(pole['then'], 'дать 1 возм.')[0]['then'].append(step(ch)); return
    if br.startswith('d6'):
        key = br[3:].replace('–', '-')
        node = walk(eff, lambda n: key in (n.get('d6') or {}))
        node['d6'][key].append(step(ch)); return
    where = eff
    if parts[0] in ('А', 'Б'): where = option(eff, parts[0])
    elif parts[0] in ('суд', 'перекраситься'):
        opts = option(eff, parts[0])
        if parts[0] == 'перекраситься':
            # «Перекраситься» — бросок или плата: в обоих случаях перекрасился.
            success(opts[0]['then']).append(step(ch)); opts[1]['then'].append(step(ch)); return
        where = opts[0]['then']
    rest = parts[1:] if parts[0] in ('А', 'Б', 'суд') else parts
    if not rest: where.append(step(ch)); return
    cond = rest[0]
    if cond == 'успех': success(where).append(step(ch)); return
    if cond == 'без провала':
        # «Митинг на площади»: в демократиях без риска, в диктатурах — проверка, иначе — как есть: провал только у проверки.
        node = walk(where, lambda n: 'cases' in n)
        for c in node['cases']:
            chk = walk(c['then'], lambda n: 'check' in n)
            (chk['success'] if chk else c['then']).append(step(ch))
        node.setdefault('else', []).append(step(ch)); return
    if cond == 'd6 4–6':
        walk(where, lambda n: '4-6' in (n.get('d6') or {}))['d6']['4-6'].append(step(ch)); return
    if cond == 'диктатуры и национализм':
        walk(where, lambda n: isinstance(n.get('if'), dict) and 'диктатуры' in json.dumps(n['if'], ensure_ascii=False))['then'].append(step(ch)); return
    raise ValueError('ветка не разобрана: %s' % br)


def main():
    files = {}
    for t in SC.TRACE:
        d, sub, no, name, br, ch = t
        f = FILE(d, sub)
        deck = files.setdefault(f, json.load(open(os.path.join(DECKS, f + '.json'), encoding='utf8')))
        hit = [c for c in deck['cards'] if c['title'] == name and str(c['n']) == no and (d != 'Класс' or c.get('cls') == sub)]
        if len(hit) != 1: sys.exit('карта не найдена: %s %s № %s «%s»' % (d, sub, no, name))
        c = hit[0]
        c['effect'] = strip(c['effect'])
        if c.get('sides'): c['sides'] = strip(c['sides'])
        try: place(c, br, ch)
        except Exception as e: sys.exit('%s «%s» (%s): %s' % (c['id'], name, br, e))
        c['trace'] = SC.trace_badge(t)
    for f, deck in files.items():
        json.dump(deck, open(os.path.join(DECKS, f + '.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print('след: %d карт в %d колодах' % (len(SC.TRACE), len(files)))


main()
