"""Разбор результатов sim3: счастье, победа, смыслы, семья, Итог мира; для «Рода» — наследники и Лестница."""
import json, sys, collections as C, statistics as S
import meanings as MN
d = json.load(open(sys.argv[1])); R = d['rows']; G = d['games']; t = d['tot']; MODE = d['MODE']
CARDS = {c['id']: c for c in MN.parse()}
def pc(a, b): return 100.0 * a / b if b else 0.0
def mean(v): return S.mean(v) if v else float('nan')
def line(*a): print(*a)
n = len(R)
line('== %s: игр %d, раундов %d, жизней %d, env %s' % (MODE, d['N'], d['ROUNDS'], n, d['env']))

def block(rows, title):
    h = [r['happy'] for r in rows]
    line('-- %s: n=%d  среднее %.2f  медиана %.1f  7+ %.1f%%  ≤3 %.1f%%  0 %.1f%%' % (title, len(rows), mean(h), S.median(h) if h else 0,
         pc(sum(x >= 7 for x in h), len(h)), pc(sum(x <= 3 for x in h), len(h)), pc(sum(x == 0 for x in h), len(h))))

block(R, 'все жизни')
line('гистограмма счастья:', ' '.join('%d:%.1f%%' % (k, pc(v, n)) for k, v in sorted(C.Counter(int(r['happy']) for r in R).items())))
for k in ('grey', 'random', 'dyn', 'std', None): block([r for r in R if r['deck'] == k], 'колода %s' % k)
for k in ('Простой', 'Средний', 'Сложный'): block([r for r in R if r['kind'] == k], 'сложность %s' % k)
block([r for r in R if r['deck'] == 'random' and r['unreach'] == 0], 'случайные без недостижимых условий')
block([r for r in R if r['deck'] in ('random', 'dyn') and r['unreach'] > 0], 'карты с недостижимыми (эмиграция и пр.)')
line()
line('по позиции страны рождения:', '  '.join('%s %.2f (7+ %.0f%%)' % (k, mean([r['happy'] for r in R if r['pos_birth'] == k]), pc(sum(1 for r in R if r['pos_birth'] == k and r['happy'] >= 7), sum(1 for r in R if r['pos_birth'] == k))) for k in ('ядро', 'полупериферия', 'периферия')))
line('по классу рождения:', '  '.join('%s %.2f' % (k, mean([r['happy'] for r in R if r['cls0'] == k])) for k in ('Народ', 'Армия', 'Полиция', 'Интеллигенция', 'Мафия', 'Олигархи')))
line('по финансам семьи:', '  '.join('%+d %.2f' % (k, mean([r['happy'] for r in R if r['fin0'] == k])) for k in range(-3, 4)))
line('по Мудрости в конце:', '  '.join('%s %.2f (Серость %.0f%%)' % (lab, mean([r['happy'] for r in R if lo <= r['W'] <= hi]), pc(sum(1 for r in R if lo <= r['W'] <= hi and r['grey']), sum(1 for r in R if lo <= r['W'] <= hi))) for lab, lo, hi in (('0–3', 0, 3), ('4–6', 4, 6), ('7–9', 7, 9), ('10+', 10, 99))))
line('по отрезку конца:', '  '.join('%s %.2f (%d)' % (k, mean([r['happy'] for r in R if r['maxseg'] == i]), sum(1 for r in R if r['maxseg'] == i)) for i, k in enumerate(['Д', 'Ю', 'М', 'З', 'С', 'Др'])))
line('по идеологии при рождении:', '  '.join('%s %.2f' % (k[:6], mean([r['happy'] for r in R if r['ideo0'] == k])) for k in sorted({r['ideo0'] for r in R})))
line()
# семья, образование
line('семья: в браке когда-либо %.1f%%, в браке в конце %.1f%%, партнёр когда-либо %.1f%%, ребёнок %.1f%%, двое+ %.1f%%' % (
    pc(sum(1 for r in R if r['wed']), n), pc(sum(1 for r in R if r['spouse']), n), pc(sum(1 for r in R if r['partners']), n),
    pc(sum(1 for r in R if r['kids']), n), pc(sum(1 for r in R if r['kids'] >= 2), n)))
line('свадьбы: на развилке %d, «Храм или бюро» %d; развилка с партнёром: А %d / Б %d / В %d; без партнёра: искать %d / через родню %d' % (
    t.get('wed_fork', 0), t.get('wed_hram', 0), t.get('part_has_A', 0), t.get('part_has_B', 0), t.get('part_has_C', 0), t.get('part_none_A', 0), t.get('part_none_B', 0)))
ne = t.get('edu_n', 0)
line('образование: на развилке %d, средний шанс поступить %.0f%%, пошли в вуз %.1f%%, поступили %.1f%%, училище %.1f%%; диплом у %.1f%% жизней, из них в Интеллигенцию %d' % (
    ne, pc(t.get('edu_ps_sum', 0), ne), pc(t.get('edu_try', 0), ne), pc(t.get('edu_A', 0), ne), pc(t.get('edu_B', 0), ne), pc(sum(1 for r in R if r['dip']), n), t.get('diploma_to_intel', 0)))
line('Серость %.1f%%, Династия %.1f%% (попыток отказа %d, удачных %d), смена карты в кризис %.1f%% от нашедших раньше' % (
    pc(sum(1 for r in R if r['grey']), n), pc(sum(1 for r in R if r['src'] == 'dyn' or r['dyn']), n), sum(1 for r in R if r['ref_try']),
    t.get('refuse_ok', 0), pc(t.get('crisis_swap', 0), sum(1 for r in R if r['src'] in ('crisis', 'Детство', 'Юность', 'Молодость')))))
line('Привычка: получили %d, сняли %d; Судимость погашена временем %d' % (t.get('habit_on', 0), t.get('habit_off', 0), t.get('off_Судимость', 0)))
line()
# условия
cs = C.Counter(); cg = C.Counter()
for r in R:
    if r['card'] and r['card'] in CARDS and r['deck'] in ('random', 'dyn', 'grey'):
        c = CARDS[r['card']]
        for i, cd in enumerate(c['conds']):
            cs[cd[1]] += 1; cg[cd[1]] += (i in r['got'])
line('Серость, выполнение условий:')
for cd in CARDS['С']['conds']: line('   %5.1f%%  %s' % (pc(cg[cd[1]], cs[cd[1]]), cd[1]))
rows = [(pc(cg[k], cs[k]), cs[k], k) for k in cs if cs[k] >= 40]
rows.sort()
line('самые трудные условия (держатели ≥40):'); [line('   %5.1f%% (%d) %s' % x) for x in rows[:15]]
line('самые лёгкие:'); [line('   %5.1f%% (%d) %s' % x) for x in rows[-15:]]
pcard = C.defaultdict(list)
for r in R:
    if r['card'] and r['deck'] in ('random', 'dyn') and not r['end_alive']: pcard[r['card']].append(r['happy'])
pr = sorted([(mean(v), len(v), k, CARDS[k]['name'], CARDS[k]['kind'], CARDS[k]['unreach_pts']) for k, v in pcard.items() if len(v) >= 25])
line('карты: худшие'); [line('   %.2f (%d) %s %s [%s] недост.%d' % x) for x in pr[:12]]
line('карты: лучшие'); [line('   %.2f (%d) %s %s [%s] недост.%d' % x) for x in pr[-12:]]
line('разброс средних по картам: от %.2f до %.2f, стандартное отклонение %.2f' % (pr[0][0], pr[-1][0], S.pstdev([x[0] for x in pr])))

# победа в «Поколении»
if MODE == 'gen':
    wins = C.Counter(); seen = C.Counter(); wins_pos = C.Counter(); seen_pos = C.Counter(); wins_cls = C.Counter(); seen_cls = C.Counter()
    by_g = C.defaultdict(list)
    for r in R: by_g[r['g']].append(r)
    margin = []
    for g, rs in by_g.items():
        best = max(rs, key=lambda r: (r['happy'], r['end_alive'], r['end']))
        hs = sorted([r['happy'] for r in rs], reverse=True); margin.append(hs[0] - hs[1])
        for r in rs:
            key = r['deck']; seen[key] += 1; seen_pos[r['pos_birth']] += 1; seen_cls[r['cls0']] += 1
        wins[best['deck']] += 1; wins_pos[best['pos_birth']] += 1; wins_cls[best['cls0']] += 1
    line(); line('ПОБЕДА (максимум счастья), доля побед на одного игрока (база 25%):')
    line('   по колоде:', '  '.join('%s %.1f%%' % (k, pc(wins[k], seen[k])) for k in seen))
    line('   по позиции:', '  '.join('%s %.1f%%' % (k, pc(wins_pos[k], seen_pos[k])) for k in seen_pos))
    line('   по классу:', '  '.join('%s %.1f%%' % (k, pc(wins_cls[k], seen_cls[k])) for k in seen_cls))
    line('   отрыв победителя: среднее %.2f, ничьих по счастью %.1f%%' % (mean(margin), pc(sum(1 for m in margin if m == 0), len(margin))))

# Итог мира
ep = C.Counter(g['ep'] for g in G); idx = [g['idx'] for g in G]
line(); line('ИТОГ МИРА: индекс среднее %.1f, медиана %.0f' % (mean(idx), S.median(idx)))
line('   эпохи:', '  '.join('%s %.1f%%' % (k, pc(v, len(G))) for k, v in ep.most_common()))
line('   жизней со смыслом (7+) %.1f%%, без смысла (≤3) %.1f%% от всех' % (pc(sum(g['info']['mean_l'] for g in G), sum(g['info']['n'] for g in G)), pc(sum(g['info']['empty_l'] for g in G), sum(g['info']['n'] for g in G))))

if MODE == 'rod':
    line(); line('РОД:')
    seats = [s for g in G for s in g['seats']]
    ng = [len(s['h']) for s in seats]
    line('   поколений на род: среднее %.2f, распределение %s' % (mean(ng), dict(sorted(C.Counter(ng).items()))))
    line('   род прерван: %.1f%% родов' % pc(sum(1 for s in seats if s['cut']), len(seats)))
    ty = C.Counter(r['heir'] for r in R)
    line('   жизни по типу: %s' % dict(ty))
    for k in ('first', 'child', 'std'):
        rr = [r for r in R if r['heir'] == k]
        block(rr, 'тип %s (все)' % k); block([r for r in rr if not r['end_alive']], 'тип %s (завершённые жизни)' % k)
    lad = [s['ladder'] for s in seats]
    line('   Лестница: среднее %.2f, распределение %s' % (mean(lad), dict(sorted(C.Counter(lad).items()))))
    # последний — живой на конце часов
    last_alive = [s for s in seats if s['alive_end'] and s['alive_end'][-1] and len(s['h']) >= 2]
    lastdrop = sum(1 for s in last_alive if s['h'][-1] < s['h'][-2])
    line('   последнее поколение живо на конце часов: %.1f%% родов; из них последний шаг Лестницы −1: %.1f%%' % (pc(len(last_alive), len(seats)), pc(lastdrop, len(last_alive))))
    short = [s for s in last_alive if s['ends'][-1] - s['born'][-1] < 20]
    line('   последний наследник прожил меньше 20 ходов: %.1f%% родов; счастье у них %.2f' % (pc(len(short), len(seats)), mean([s['h'][-1] for s in short])))
    # шаги лестницы по типам
    step = C.Counter(); stepn = C.Counter()
    for s in seats:
        for a, b, tp, al in zip(s['h'], s['h'][1:], s['types'][1:], s['alive_end'][1:]):
            key = tp + (' (жив на конце)' if al else '')
            stepn[key] += 1; step[key] += 2 if b > a else -1 if b < a else 0
    line('   средний шаг Лестницы по типу наследника:', '  '.join('%s %.2f (%d)' % (k, step[k] / stepn[k], stepn[k]) for k in stepn))
    # кто выигрывает лестницу
    wins = C.Counter(); seen = C.Counter()
    for g in G:
        sc = [(s['ladder'], sum(s['h'])) for s in g['seats']]; best = max(range(4), key=lambda i: sc[i])
        for i, s in enumerate(g['seats']):
            k = 'с детьми' if 'child' in s['types'] else ('только стандартные' if 'std' in s['types'] else 'одно поколение')
            seen[k] += 1; wins[k] += (i == best)
    line('   победа в Лестнице по истории рода:', '  '.join('%s %.1f%% (%d)' % (k, pc(wins[k], seen[k]), seen[k]) for k in seen))
    line('   наследование: ребёнок %d, стандартный %d, прерван %d' % (t.get('heir_child', 0), t.get('heir_std', 0), t.get('lineage_cut', 0)))
