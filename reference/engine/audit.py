import json, collections as C, statistics as S, sys
sys.path.insert(0,'/home/claude/zhizn/v2')
import meanings as MN
CARDS={c['id']:c for c in MN.parse()}
def pc(a,b): return 100*a/b if b else 0
def load(fs):
    R=[];T=C.Counter();G=[]
    for i,f in enumerate(fs):
        d=json.load(open(f)); T.update(d['tot'])
        for k,gm in enumerate(d['games']): gm['key']=(i,k); G.append(gm)
        for r in d['rows']: r['G']=(i,r['g']); R.append(r)
    return R,T,G
def audit(label, fs):
    R,T,G=load(fs); n=len(R); g=len(G); out=C.OrderedDict()
    out['жизней/партий']='%d / %d'%(n,g)
    # здоровье и выживание
    for k in ('ядро','полупериферия','периферия'):
        rb=[r for r in R if r['pos_birth']==k]
        out['до Старости / Древности: '+k]='%.0f%% / %.0f%%'%(pc(sum(r['maxseg']>=4 for r in rb),len(rb)),pc(sum(r['maxseg']==5 for r in rb),len(rb)))
    dc=C.Counter(r['death'][1].split(' ')[0] if r['death'] else 'жив' for r in R)
    out['смерти: возраст / физ / псих / кабала / прочее']='%.1f%% / %.1f%% / %.1f%% / %.1f%% / %.1f%%'%(pc(dc['возраст'],n),pc(dc['физ'],n),pc(dc['психика'],n),pc(dc.get('кабала',0),n),pc(n-dc['жив']-dc['возраст']-dc['физ']-dc['психика']-dc.get('кабала',0),n))
    kid=[r for r in R if r['death'] and r['death'][0] in ('Детство','Юность') and r['death'][1].startswith('псих')]
    out['дети и подростки умерли от психики']=len(kid)
    out['срывы на жизнь / подростковые срывы / подростковая психбольница']='%.2f / %.1f%% / %.1f%%'%(T.get('sryv',0)/n,pc(T.get('teen_sryv',0),n),pc(T.get('teen_ward',0),n))
    out['тюрьма хоть раз / кабала / психбольница (заходов на 100 жизней)']='%.1f%% / %.1f / %.1f'%(pc(sum(r['n_prison']>0 for r in R),n),100*T.get('inst_Кабала',0)/n,100*T.get('inst_Психбольница',0)/n)
    out['физ / псих к концу; псих +3 и выше']='%+.1f / %+.1f; %.0f%%'%(S.mean(r['phys'] for r in R),S.mean(r['psy'] for r in R),pc(sum(r['psy']>=3 for r in R),n))
    # экономика
    mk={k[3:]:v/n for k,v in T.items() if k.startswith('mk_')}
    out['за жизнь: больница / психолог / работа / подработка']='%.1f / %.1f / %.1f / %.1f'%(mk.get('Больница',0),mk.get('Психолог',0),mk.get('Работа',0),mk.get('Подработка',0))
    out['за жизнь: спортзал / курсы / салон / путешествие / хобби / храм']='%.2f / %.2f / %.2f / %.2f / %.2f / %.2f'%(mk.get('Спортзал',0),mk.get('Курсы',0),mk.get('Салон',0),mk.get('Путешествие',0),mk.get('Хобби',0),mk.get('Храм',0))
    out['за жизнь: ловушки (бар/казино/лотерея/бордель) / микрозаймы / банк']='%.2f / %.2f / %.2f'%(sum(mk.get(x,0) for x in ('Бар','Казино','Лотерея','Бордель')),mk.get('Микрозаймы',0),mk.get('Банк',0))
    out['Возможности к концу, медиана: ядро / полупер. / периф.']=' / '.join('%.0f'%S.median([r['vozm'] for r in R if r['pos']==k]) for k in ('ядро','полупериферия','периферия'))
    out['сгорело Возможностей сверх потолка, на жизнь']='%.1f'%(T.get('burned',0)/n)
    # классы
    c0=C.Counter(r['cls0'] for r in R); c1=C.Counter(r['cls'] for r in R)
    out['классы рождение → конец']=', '.join('%s %.0f→%.0f'%(k[:4],pc(c0[k],n),pc(c1[k],n)) for k in ('Народ','Армия','Полиция','Интеллигенция','Мафия','Олигархи'))
    ol=[r for r in R if r['cls0']=='Олигархи']; out['Олигархи сменили класс']='%.0f%%'%pc(sum(r['cls']!='Олигархи' for r in ol),len(ol))
    out['диплом / вступительные сданы из попыток']='%.0f%% / %.0f%%'%(pc(sum(r['dip'] for r in R),n),pc(T.get('edu_A',0)+0,T.get('edu_try',0) or 1) if False else pc(T.get('edu_try',0)-T.get('edu_fail',0),T.get('edu_try',0)))
    ar=[r for r in R if r['cls0']=='Армия']; out['рождённые в Армии: «Присяга» / звание']='%.0f%% / %.0f%%'%(pc(sum(r['oath'] for r in ar),len(ar)),pc(sum(r['rank'] for r in ar),len(ar)))
    # семья
    out['брак / дети / двое+ / бастарды на 100 / ребёнок из путешествия на 100']='%.0f%% / %.0f%% / %.0f%% / %.1f / %.1f'%(pc(sum(r['wed']>0 for r in R),n),pc(sum(r['kids']>0 for r in R),n),pc(sum(r['kids']>=2 for r in R),n),100*T.get('bastard',0)/n,100*T.get('travel_kid',0)/n)
    # эмиграция
    em=[r for r in R if r['emig']>0]
    out['эмиграция / бегство / вернулись / депортации на 100 / без документов']='%.1f%% / %.1f%% / %.1f%% / %.1f / %.1f%%'%(pc(len(em),n),pc(sum(r['flight']>0 for r in R),n),pc(sum(r['returned']>0 for r in R),n),100*T.get('deported',0)/n,pc(sum(r['nodocs'] for r in R),n))
    # стигмы и проверки
    out['стигмы получено на 100 жизней: Дурная слава / Судимость / Долг / Враг']='%.0f / %.0f / %.0f / %.0f'%(100*(T.get('item_стигма_Дурная слава',0)+T.get('item_стигма_Дурная слава (работа)',0))/n,100*T.get('item_стигма_Судимость',0)/n,100*(T.get('item_стигма_Долг',0)+T.get('item_стигма_Долг (микрозаймы)',0))/n,100*T.get('item_стигма_Враг',0)/n)
    ch={k[4:]:v for k,v in T.items() if k.startswith('chk_') and k not in ('chk_ok','chk_fail') and '_' not in k[4:]}
    tc=sum(ch.values())
    out['проверки: доля по характеристикам']=', '.join('%s %.0f%%'%(k[:4],pc(v,tc)) for k,v in sorted(ch.items(),key=lambda x:-x[1]))
    out['проверки: успех']='%.0f%%'%pc(T.get('chk_ok',0),T.get('chk_ok',0)+T.get('chk_fail',0))
    stats=['Сила','Выносливость','Ловкость','Интеллект','Мудрость','Харизма','Смекалка','Красота']
    out['характеристики к концу (среднее)']=', '.join('%s %.1f'%(k[:4],S.mean(r['st'][k] for r in R)) for k in stats)
    # счастье
    out['счастье: среднее / медиана / 7+ без Серости / 3 и ниже / 0']='%.2f / %.1f / %.0f%% / %.0f%% / %.0f%%'%(S.mean(r['happy'] for r in R),S.median(r['happy'] for r in R),pc(sum(r['happy']>=7 and r['deck']!='grey' for r in R),n),pc(sum(r['happy']<=3 for r in R),n),pc(sum(r['happy']==0 for r in R),n))
    dk={k:[r['happy'] for r in R if r['deck']==k] for k in ('grey','random','dyn')}
    out['колоды: Серость / Случайные / Династии (доля)']=' / '.join('%.2f (%.0f%%)'%(S.mean(v),pc(len(v),n)) for v in dk.values())
    RR=[r for r in R if r['card'] and r['deck'] in ('random','dyn')]
    km={k:S.mean(r['happy'] for r in RR if r['kind']==k) for k in ('Простой','Средний','Сложный')}
    out['Простые / Средние / Сложные']='%.2f / %.2f / %.2f'%(km['Простой'],km['Средний'],km['Сложный'])
    unreach=sum(1 for c in CARDS.values() for pts,t,typ,f,flag in c['conds'] if f is None)
    out['условий, которые модель не может проверить']=unreach
    if G and 'seats' in G[0] and MODE_GEN(fs):
        pass
    games=C.defaultdict(list)
    for r in R: games[r['G']].append(r)
    EP={gm['key']:gm['ep'] for gm in G}
    w=C.Counter(); s=C.Counter(); gw=C.Counter()
    for key,rs in games.items():
        b=max(rs,key=lambda r:(r['happy'],r['end']))
        for r in rs:
            for kk in (r['deck'],r['pos_birth'],'cls:'+r['cls0']): s[kk]+=1; w[kk]+=(r is b)
        if b['deck']=='grey': gw[EP[key]]+=1
    out['победы на игрока: Серость / Случайные / Династии']=' / '.join('%.0f%%'%pc(w[k],s[k]) for k in ('grey','random','dyn'))
    out['победы на игрока: ядро / полупер. / периф.']=' / '.join('%.0f%%'%pc(w[k],s[k]) for k in ('ядро','полупериферия','периферия'))
    out['победы на игрока по классу рождения']=', '.join('%s %.0f%%'%(k[:4],pc(w['cls:'+k],s['cls:'+k])) for k in ('Народ','Армия','Полиция','Интеллигенция','Мафия','Олигархи'))
    ch_=sum(gw[e] for e in ('Эпоха пепла','Эпоха переворотов','Эпоха страха','Новая Последняя война','Эпоха серых пальто'))
    out['победы Серости в хаосе и «серых пальто»']='%.0f%% (%d побед)'%(pc(ch_,sum(gw.values())),sum(gw.values()))
    eps=C.Counter(gm['ep'] for gm in G)
    out['эпохи']=', '.join('%s %.0f%%'%(k.replace('Эпоха ',''),pc(v,g)) for k,v in eps.most_common())
    out['смен власти / кризисов / Смут за партию']='%.1f / %.1f / %.1f'%(T.get('power_change',0)/g,T.get('crisis',0)/g,T.get('smuta_card',0)/g)
    out['мир: глобальных / местных / спокойных событий за партию']='%.1f / %.1f / %.1f'%(T.get('world_глобальный',0)/g,T.get('world_местный',0)/g,T.get('world_спокойно',0)/g)
    out['развилки: Образование / Эмиграция / Ребёнок (на жизнь); дошли остаток хода']='%.2f / %.2f / %.2f; %.2f'%(T.get('edu_n',0)/n,T.get('fork_emig',0)/n,T.get('fork_child',0)/n,T.get('fork_walk_on',0)/n)
    out['модель: неизвестных условий (50/50) на жизнь / пропущено карт по условию']='%.2f / %.2f'%(T.get('cond_unknown',0)/n,T.get('only_skip',0)/n)
    return out, R, G
def MODE_GEN(fs): return True
o,R,G=audit('F17',['/tmp/F17.json'])
for k,v in o.items(): print('%-75s %s'%(k,v))
# Род
for nm in ('/tmp/R17_20.json','/tmp/R17_30.json'):
    d=json.load(open(nm)); G=d['games']; R=d['rows']; seats=[s for g in G for s in g['seats']]
    wins=C.Counter(); seen=C.Counter()
    for g in G:
        sc=[(s['ladder2'],sum(s['h'])) for s in g['seats']]; best=max(range(len(sc)),key=lambda i:sc[i])
        for i,s in enumerate(g['seats']):
            k='дети' if 'child' in s['types'] else ('станд' if 'std' in s['types'] else 'одно'); seen[k]+=1; wins[k]+=(i==best)
    me=sum(g['info']['mean_e'] for g in G); ne=sum(g['info']['n_e'] for g in G); ee=sum(g['info']['empty_e'] for g in G)
    eps=C.Counter(g['ep'] for g in G)
    ch=[r for r in R if r['heir']=='child' and not r['end_alive']]
    print('%s: партий %d; поколений %.2f; прерван %.1f%%; с ребёнком-наследником %.0f%%; L2 победы: дети %.0f%% (%d), станд %.0f%% (%d); завершённые выращенные: смысл %.0f%%, пустые %.0f%%, счастье %.2f; эпохи: %s'%(nm[5:-5],len(G),S.mean(len(s['h']) for s in seats),100*sum(s['cut'] for s in seats)/len(seats),100*sum('child' in s['types'] for s in seats)/len(seats),100*wins['дети']/max(1,seen['дети']),seen['дети'],100*wins['станд']/max(1,seen['станд']),seen['станд'],100*me/ne,100*ee/ne,S.mean(r['happy'] for r in ch),', '.join('%s %.0f%%'%(k.replace('Эпоха ',''),100*v/len(G)) for k,v in eps.most_common(7))))
