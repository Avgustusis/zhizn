"""Экономика: доход и уровень Возможностей по классам, идеологиям, делу. Хук на каждый ход игрока."""
import sys, os, time, json, collections as C, statistics as S
sys.path.insert(0, '/home/claude/pkg/engine')
import random, war_life as WL
N = int(sys.argv[1]); random.seed(int(os.environ.get('SEED', '1')))
A = C.defaultdict(lambda: [0, 0.0, 0.0, 0, 0, 0.0])   # n, sum Δvozm, sum Д, cap, debt, sum vozm
ORIG = WL.World2.step


def step(s, p):
    if p is None or not p.alive or p.done or p.inst: return ORIG(s, p)
    v0 = p.vozm; seg = p.seg
    ORIG(s, p)
    if not p.alive or seg < 2 or seg > 3: return       # Молодость и Зрелость — рабочие годы
    ideo = s.country(p)['ideo']; WL.SO.COUNT = False; d = s.income(p); WL.SO.COUNT = True
    biz = 'дело' if p.biz is not None else 'найм'
    for key in (('cls', p.cls), ('ideo', ideo), ('cls×ideo', p.cls + '|' + ideo), ('biz', p.cls + '|' + biz), ('bizideo', ideo + '|' + biz), ('all', '')):
        a = A[key]; a[0] += 1; a[1] += p.vozm - v0; a[2] += d; a[3] += p.vozm >= 15; a[4] += p.vozm < 0; a[5] += p.vozm


WL.World2.step = step
t = time.time(); R = WL.run_games(N, 50)
out = {}
for (k, v), a in A.items():
    n = a[0]
    out.setdefault(k, {})[v] = dict(n=n, dv=round(a[1] / n, 2), D=round(a[2] / n, 2), cap=round(100 * a[3] / n, 1), debt=round(100 * a[4] / n, 1), lvl=round(a[5] / n, 2))
L = R['lives']
fin = C.defaultdict(list)
for p in L: fin[p.get('cls') if isinstance(p, dict) else p.cls].append(p['vozm'] if isinstance(p, dict) else p.vozm)
out['final'] = {c: round(S.mean(v), 2) for c, v in fin.items()}
out['burned'] = round(R['tot']['burned'] / len(L), 2)
out['sec'] = round(time.time() - t)
out['bizstats'] = {k: round(v / N, 3) for k, v in R['tot'].items() if k.startswith(('biz_', 'kont_', 'mk_'))}
out['owned'] = round(100 * sum(1 for p in L if p.bz['got'] > 0) / len(L), 1); out['own_turns'] = round(sum(p.bz['turns'] for p in L) / len(L), 2)
out['stazh'] = round(S.mean(p.stazh for p in L), 2)
out['owned_cls'] = {c: round(100 * sum(1 for p in L if p.cls == c and p.bz['got'] > 0) / max(1, sum(1 for p in L if p.cls == c)), 1) for c in set(p.cls for p in L)}
T = R['tot']; out['soc'] = {k: round(v / N, 3) for k, v in T.items() if k.startswith('soc_')}
out['wts'] = round(R['wts'] / N, 1); out['drev'] = round(100 * sum(1 for p in L if p.maxseg == 5) / len(L), 2); out['happy'] = round(S.mean(p.happy for p in L), 3)
out['life_mean_vozm_turn'] = None
json.dump(out, open(os.environ.get('OUT', '/tmp/econ.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', out['sec'])
