"""Сравнение: без своего дела (BIZ=0) против с делом (BIZ=1); владельцы против наёмных."""
import json, sys, collections as C
from statistics import mean

def load(f): return json.load(open(f))
def avg(xs): xs = [x for x in xs if x is not None]; return mean(xs) if xs else float('nan')
def pct(xs): xs = list(xs); return 100 * sum(1 for x in xs if x) / len(xs) if xs else float('nan')

def summary(rows):
    return dict(n=len(rows), happy=avg(r['happy'] for r in rows), drev=pct(r['maxseg'] >= 5 for r in rows),
                early=pct(r['maxseg'] < 4 and not r['end_alive'] for r in rows), vozm=avg(r['vozm'] for r in rows),
                maxv=avg(r['max_v'] for r in rows), lowpsy=avg(r['lowpsy'] for r in rows), lowphys=avg(r['lowphys'] for r in rows),
                stazh=avg(r['stazh'] for r in rows))

def line(name, s):
    return f"{name:<28} n={s['n']:>6}  счастье {s['happy']:.2f}  Древность {s['drev']:5.1f}%  умер до Старости {s['early']:5.1f}%  возм. в конце {s['vozm']:5.1f}  пик {s['maxv']:5.1f}  ходов псих≤−5 {s['lowpsy']:4.1f}  физ≤−5 {s['lowphys']:4.1f}  Стаж {s['stazh']:4.1f}"

b0, b1 = load(sys.argv[1]), load(sys.argv[2])
r0, r1 = b0['rows'], b1['rows']
print('== Весь мир ==')
print(line('без дела (BIZ=0)', summary(r0)))
print(line('с делом (BIZ=1)', summary(r1)))
own = [r for r in r1 if r['biz_got']]
print(f"\nХоть раз владели делом: {100*len(own)/len(r1):.1f}% жизней; дожили до Молодости: "
      f"{100*len(own)/max(1,sum(1 for r in r1 if r['maxseg']>=2)):.1f}% из взрослых")
t = b1['tot']
print('Получено дел:', {k[8:]: v for k, v in sorted(t.items()) if k.startswith('biz_got_')})
print('Потеряно:', {k[9:]: v for k, v in sorted(t.items()) if k.startswith('biz_lost_')}, ' выросло', t.get('biz_grew', 0), ' продано', t.get('biz_sold', 0))
print(f"Ходов «Дело»: {t.get('mk_Дело',0)},  «Работа»: {t.get('mk_Работа',0)}, «Переработка»: {t.get('mk_Переработка',0)}")
inc = [r['biz_inc'] / r['biz_turns'] for r in own if r['biz_turns']]
print(f"Средний доход «Дела» за ход: {avg(inc):.2f}")

print('\n== Владельцы против остальных взрослых (BIZ=1), по классу рождения ==')
adult = [r for r in r1 if r['maxseg'] >= 2]
for cls in ['Народ', 'Армия', 'Полиция', 'Интеллигенция', 'Мафия', 'Олигархи']:
    a = [r for r in adult if r['cls0'] == cls and r['biz_got']]
    b = [r for r in adult if r['cls0'] == cls and not r['biz_got']]
    if len(a) < 30: print(f"{cls}: владельцев {len(a)} — мало"); continue
    print(line(cls + ' — владельцы', summary(a)))
    print(line(cls + ' — наёмные', summary(b)))

print('\n== То же, только дожившие до Зрелости (уравнивает шанс получить дело) ==')
z = [r for r in r1 if r['maxseg'] >= 3]
print(line('владельцы', summary([r for r in z if r['biz_got']])))
print(line('остальные', summary([r for r in z if not r['biz_got']])))

print('\n== По идеологии страны (владельцы, дожившие до Зрелости) ==')
for ideo in sorted({r['ideo'] for r in z}):
    a = [r for r in z if r['biz_got'] and r['ideo'] == ideo]; b = [r for r in z if not r['biz_got'] and r['ideo'] == ideo]
    if len(a) >= 20:
        sa, sb = summary(a), summary(b)
        lost = pct(r['biz_lost'] > 0 for r in a)
        print(f"{ideo:<24} владельцев {sa['n']:>5}  счастье {sa['happy']:.2f} (наёмные {sb['happy']:.2f})  возм. {sa['vozm']:5.1f} ({sb['vozm']:5.1f})  потеряли дело {lost:4.1f}%")

print('\n== По виду дела (первое дело, дожившие до Зрелости) ==')
kinds = C.defaultdict(list)
for r in z:
    if r['biz_got']: kinds[r['biz_now'] or ('потеряно' if r['biz_lost'] else 'продано')].append(r)
for k, v in sorted(kinds.items(), key=lambda kv: -len(kv[1])):
    s = summary(v); print(f"{k:<22} n={s['n']:>5}  счастье {s['happy']:.2f}  возм. {s['vozm']:5.1f}  Древность {s['drev']:4.1f}%")
