import json, sys
from statistics import mean, pstdev
rows = []
for f in sys.argv[1:]: rows += json.load(open(f))['rows']
def S(rs):
    n=len(rs); h=[r['happy'] for r in rs if r['happy'] is not None]
    return dict(n=n, happy=mean(h), se=pstdev(h)/len(h)**.5, drev=100*sum(r['maxseg']>=5 for r in rs)/n,
                early=100*sum(r['maxseg']<4 and not r['end_alive'] for r in rs)/n, vozm=mean(r['vozm'] for r in rs),
                lowpsy=mean(r['lowpsy'] for r in rs), lowphys=mean(r['lowphys'] for r in rs), stazh=mean(r['stazh'] for r in rs),
                got=100*sum(r['biz_got']>0 for r in rs)/n, lost=100*sum(r['biz_lost']>0 for r in rs)/n)
def show(nm, s): print(f"{nm:<30} n={s['n']:>5} получили дело {s['got']:5.1f}%  счастье {s['happy']:.2f}±{s['se']:.2f}  Древность {s['drev']:5.1f}%  умер до Старости {s['early']:4.1f}%  возм. {s['vozm']:5.1f}  псих≤−5 {s['lowpsy']:4.1f}  физ≤−5 {s['lowphys']:4.1f}  Стаж {s['stazh']:4.1f}  потеряли {s['lost']:4.1f}%")
A=[r for r in rows if r['biz_arm']==1]; B=[r for r in rows if r['biz_arm']==2]
print(f"всего жизней {len(rows)}, получили предложение {100*(len(A)+len(B))/len(rows):.1f}%")
show('берут дело (опыт)', S(A)); show('отказываются (контроль)', S(B))
print()
for cls in ['Народ','Армия','Полиция','Интеллигенция','Мафия','Олигархи']:
    a=[r for r in A if r['cls0']==cls]; b=[r for r in B if r['cls0']==cls]
    if min(len(a),len(b))>=40: show(cls+' берут',S(a)); show(cls+' отказ',S(b))
print()
for pos in ['ядро','полупериферия','периферия']:
    a=[r for r in A if r['pos_birth']==pos]; b=[r for r in B if r['pos_birth']==pos]
    if min(len(a),len(b))>=40: show(pos+' берут',S(a)); show(pos+' отказ',S(b))
print()
for ideo in sorted({r['ideo'] for r in rows}):
    a=[r for r in A if r['ideo']==ideo]; b=[r for r in B if r['ideo']==ideo]
    if min(len(a),len(b))>=40:
        sa,sb=S(a),S(b); print(f"{ideo:<24} берут {sa['happy']:.2f} / отказ {sb['happy']:.2f}  разница {sa['happy']-sb['happy']:+.2f}  возм. {sa['vozm']-sb['vozm']:+.1f}  потеряли дело {sa['lost']:4.1f}%")
