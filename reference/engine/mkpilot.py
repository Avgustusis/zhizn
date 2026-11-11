"""Пилотные средние по картам смысла: итоговое счастье и счёт при входе в Зрелость — для решений ИИ (отказ, кризис)."""
import json, sys, random, collections as C, statistics as S
import meanings as MN
d = json.load(open(sys.argv[1])); R = d['rows']
fin = C.defaultdict(list); atZ = C.defaultdict(list)
for r in R:
    if r['card'] and r['deck'] in ('random', 'dyn') and not r['end_alive']: fin[r['card']].append(r['happy'])
    if r['cardZ'] and r['scoreZ'] is not None: atZ[r['cardZ']].append(r['scoreZ'])
allm = S.mean([x for v in fin.values() for x in v])
mean = {k: (sum(v) + 4 * allm) / (len(v) + 4) for k, v in fin.items()}   # сглаживание к общему среднему
cards = MN.parse(); rnd = [c['id'] for c in cards if c['deck'] == 'random']
b3 = S.mean(max(mean.get(x, allm) for x in random.sample(rnd, 3)) for _ in range(20000))
out = dict(mean=mean, atZ={k: S.mean(v) for k, v in atZ.items()}, best3=b3, all=allm, n={k: len(v) for k, v in fin.items()})
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
print('all %.2f best3 %.2f cards %d' % (allm, b3, len(mean)))
