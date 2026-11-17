"""Война в жизни: поле «Фронт» внутри sim3 + привязка классов к идеологиям и новая смена власти (ноябрь 2026).

Запуск:  python3 war_life.py N [ROUNDS]        — N партий, печатает сводку по жизням, войнам и странам.
Переключатели среды:
  WAR=front  — война по разделу «Война» концепции: призыв, ход солдата на «Фронте», хранитель часов, итоги войны (по умолчанию);
  WAR=old    — как в sim3: «Война» и «Мировая война» — разовая карта, бьющая по игрокам текстом.
  BIND=1     — доминирующий и отчуждённый классы по таблице «Идеологии и классы», смена власти по новому правилу (по умолчанию);
  BIND=0     — как в sim3: случайные классы, при смене власти доминирующий и отчуждённый меняются местами.
Остальные флаги sim3 (MODE, CHAR, ACQ …) работают как обычно.

Что упрощено против настольных правил (влияние на итог малое):
  * пол призыва: оси «Патриархат ↔ Матриархат» у культур в движке нет — значение взято случайно по культуре (PATR);
  * «Повестка в ящике» и «Долг фронтом» во время войны не отправляют на «Фронт» (карты разыгрываются старым текстом);
  * добровольцев нет; «Справку» и «Друга в Генштабе» игрок тратит всегда, Мафия откупается, если хватает денег;
  * смена режима после войны: «сдвиги стабильности вдвое» не считаются; геноцид: «доход −1 два мировых хода» не считается;
  * оккупация: игрок выбирает «сотрудничать» или «сопротивляться» случайно, поровну.
"""
import os, sys, random, re, statistics as S, collections as C
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import sim3
from sim3 import World, Player, d6, roll3, DECK, THAW, exec_text, SEGS, PRANK, STAB_CAP, HARSH_I
import char as CH
import war_sim as WS

E = os.environ.get
WAR = E('WAR', 'front')
START_PEACE = float(E('START_PEACE', '0.25'))       # смена власти в момент объявления войны даёт мир: d12 10–12
INSTANT = E('INSTANT', '1') == '1'                  # войну без солдат-игроков решают два броска d6, без трека
VOLUNTEER = float(E('VOLUNTEER', '0.25'))           # доля военных (Армия, «Присяга»), уходящих добровольцами
BIND = E('BIND', '1') == '1'

IDEOS = sim3.IDEOS
CLASSES = ['Народ', 'Армия', 'Полиция', 'Интеллигенция', 'Мафия', 'Олигархи']
# ---------- «Идеологии и классы»: доминирующий и отчуждённый по d6 ----------
DOM = {'Либеральная демократия': [(4, 'Олигархи'), (6, 'Интеллигенция')],
       'Социал-демократия': [(3, 'Народ'), (6, 'Интеллигенция')],
       'Теократия': [(3, 'Полиция'), (6, 'Народ')],
       'Национализм': [(3, 'Армия'), (6, 'Полиция')],
       'Госсоциализм': [(3, 'Полиция'), (6, 'Народ')],
       'Военная диктатура': [(6, 'Армия')],
       'Клептократия': [(3, 'Олигархи'), (6, 'Мафия')],
       'Технократия': [(4, 'Интеллигенция'), (6, 'Олигархи')],
       'Полицейское государство': [(4, 'Полиция'), (6, 'Армия')],
       'Вольница': [(3, 'Народ'), (6, 'Мафия')]}
ALI = {'Либеральная демократия': [(2, 'Народ'), (4, 'Армия'), (5, 'Мафия'), (6, 'Интеллигенция')],
       'Социал-демократия': [(2, 'Олигархи'), (4, 'Армия'), (5, 'Мафия'), (6, 'Полиция')],
       'Теократия': [(3, 'Интеллигенция'), (4, 'Мафия'), (5, 'Олигархи'), (6, 'Армия')],
       'Национализм': [(2, 'Интеллигенция'), (4, 'Народ'), (5, 'Олигархи'), (6, 'Мафия')],
       'Госсоциализм': [(2, 'Интеллигенция'), (4, 'Олигархи'), (5, 'Армия'), (6, 'Мафия')],
       'Военная диктатура': [(3, 'Народ'), (5, 'Интеллигенция'), (6, 'Мафия')],
       'Клептократия': [(3, 'Народ'), (4, 'Интеллигенция'), (5, 'Армия'), (6, 'Полиция')],
       'Технократия': [(3, 'Народ'), (5, 'Мафия'), (6, 'Армия')],
       'Полицейское государство': [(3, 'Мафия'), (5, 'Интеллигенция'), (6, 'Народ')],
       'Вольница': [(3, 'Полиция'), (5, 'Армия'), (6, 'Олигархи')]}
CLOSE = {'Либеральная демократия': {'Олигархи', 'Интеллигенция'}, 'Социал-демократия': {'Народ', 'Интеллигенция'},
         'Теократия': {'Народ', 'Полиция'}, 'Национализм': {'Армия', 'Полиция'}, 'Госсоциализм': {'Народ', 'Полиция'},
         'Военная диктатура': {'Армия'}, 'Клептократия': {'Олигархи', 'Мафия'},
         'Технократия': {'Интеллигенция', 'Олигархи'}, 'Полицейское государство': {'Полиция', 'Армия'}, 'Вольница': {'Народ', 'Мафия'}}
COUP = {'Народ': ['Госсоциализм', 'Социал-демократия', 'Национализм'], 'Армия': ['Военная диктатура'],
        'Полиция': ['Национализм', 'Военная диктатура'], 'Олигархи': ['Клептократия', 'Либеральная демократия'],
        'Интеллигенция': ['Либеральная демократия', 'Социал-демократия'], 'Мафия': ['Клептократия']}
if sim3.IDEO10:
    COUP['Народ'] = COUP['Народ'] + ['Вольница']; COUP['Мафия'] = COUP['Мафия'] + ['Вольница']
    COUP['Интеллигенция'] = COUP['Интеллигенция'] + ['Технократия']; COUP['Полиция'] = COUP['Полиция'] + ['Полицейское государство']

def by_tab(tab):
    r = d6()
    for hi, cls in tab:
        if r <= hi: return cls

def roll_ali(ideo, dom):
    for _ in range(50):
        a = by_tab(ALI[ideo])
        if a != dom: return a
    return random.choice([c for c in CLASSES if c != dom])

# ---------- война: константы правил ----------
WIDE = {'Военная диктатура', 'Госсоциализм', 'Национализм'}          # призыв шире
PAID = {'Либеральная демократия', 'Социал-демократия', 'Клептократия', 'Технократия'}  # жалованье +1 возм. за ход
TREAT = {'Либеральная демократия': (1, 1), 'Социал-демократия': (2, 2), 'Теократия': (1, 1), 'Национализм': (2, 0),
         'Госсоциализм': (2, 'ward'), 'Военная диктатура': (2, 0), 'Клептократия': (0, 0),
         'Технократия': (2, 1), 'Полицейское государство': (2, 'ward'), 'Вольница': (1, 1)}
DEATH_BEN = {'Военная диктатура': dict(pos=1), 'Национализм': dict(pos=1, v=2), 'Госсоциализм': dict(v=3, coh=1),
             'Теократия': dict(coh=1), 'Социал-демократия': dict(v=3), 'Либеральная демократия': dict(v=4), 'Клептократия': {},
             'Технократия': dict(v=3), 'Полицейское государство': dict(pos=1), 'Вольница': dict(coh=1)}
POS_ORDER = ['периферия', 'полупериферия', 'ядро']
_pr = random.Random(4242)
PATR = {c: _pr.choice([-2, -1, -1, 0, 1, 1, 2]) for c in sim3.CULTS}   # допущение: позиция культур по оси «Патриархат ↔ Матриархат»

ORIG_STEP = World.step
ORIG_INIT = World.__init__
ORIG_RUN = World.run
ORIG_LEAVE = Player.leave


def p_leave(s):
    """Плен — без «Судимости», психбольница госсоциализма по комиссии — без «Учёта»."""
    if getattr(s, 'no_sud', False) and s.inst == 'Тюрьма':
        s.no_sud = False; s.log['out_ever'] += 1; s.inst = None; return
    if getattr(s, 'no_uchet', False) and s.inst == 'Психбольница':
        s.no_uchet = False; s.log['out_ever'] += 1; s.inst = None; return
    return ORIG_LEAVE(s)
Player.leave = p_leave


class Sol:
    """Солдат-игрок на «Фронте»: обёртка над Player для функций war_sim (ev, choose, cond, tactic)."""
    phys = property(lambda s: s.p.phys, lambda s, v: setattr(s.p, 'phys', v))
    psy = property(lambda s: s.p.psy, lambda s, v: setattr(s.p, 'psy', v))
    vozm = property(lambda s: s.p.vozm, lambda s, v: setattr(s.p, 'vozm', v))

    def __init__(s, p, fr, side):
        s.p = p; s.fr = fr; s.side = side; s.war = fr.W
        s.status = 'front'; s.turns = 0; s.awards = 0; s.leave = False; s.tac = None
        s.ph0, s.ps0 = p.phys, p.psy; s.st = p.st; s.char = p.char
        s.pull()

    def pull(s):
        p = s.p
        s.off = p.items.get('Офицерское звание', 0) > 0
        s.bf = p.items.get('Боевые друзья', 0) > 0
        s.mate = p.items.get('Партнёр', 0) + p.items.get('Супруг', 0) > 0
        s.pos = s.fr.w.countries[p.cidx]['pos']; s.cls = p.cls; s.st = p.st; s.char = p.char


class Front:
    _n = 0

    def __init__(s, w, sides, kind):
        Front._n += 1; s.id = Front._n
        s.w = w; s.sides = sides; s.kind = kind
        s.W = WS.War(w.countries[sides[0][0]], w.countries[sides[1][0]])
        s.sols = []; s.rounds = 0; s.start_wt = w.wt; s.start_round = w.round

    def refresh(s):
        for side in (0, 1):
            c = s.w.countries[s.sides[side][0]]
            s.W.pos[side] = c['pos']; s.W.ideo[side] = c['ideo']

    def side_of(s, ci):
        for side in (0, 1):
            if ci in s.sides[side]: return side
        return None

    def members(s): return s.sides[0] + s.sides[1]

    def active(s, side=None): return [x for x in s.sols if x.status == 'front' and (side is None or x.side == side)]


# =====================================================================
class World2(World):
    def __init__(s, rounds):
        ORIG_INIT(s, rounds)
        s.front = None; s.wars = []; s.coups = []; s.outcomes = C.Counter(); s.enlist = []
        for ci, c in enumerate(s.countries):
            c['minor'] = random.randint(1, 4) - 1; c['occ'] = None; c['embargo'] = False; c['doms'] = [c['dom']]
            if BIND:
                c['dom'] = by_tab(DOM[c['ideo']]); c['ali'] = roll_ali(c['ideo'], c['dom']); c['doms'] = [c['dom']]
                c['stab'] = 5 + (1 if c['pos'] == 'ядро' else -1 if c['pos'] == 'периферия' else 0) - (2 if c['conflict'] else 0) - (2 if c['ali'] == 'Народ' else 0)

    # ---------- ход игрока ----------
    def step(s, p):
        if p is None or not p.alive or p.done: return
        if p.inst == 'Фронт':
            p.turns += 1
            if p.skip > 0: p.skip -= 1; s.stats['skip_turn'] += 1; return
            return s.front_turn(p)
        return ORIG_STEP(s, p)

    def run(s):
        for r in range(1, s.rounds + 1):
            s.round = r
            for p in list(s.players):
                if p is not None and not p.closed: s.step(p)
            if s.front: s.front_round()
            s.sweep()
            if r % 5 == 0: s.world_turn(); s.sweep()
        for p in s.players:
            if p is not None and not p.closed: s.close(p, end=True)
        return s

    # ---------- «Фронт» ----------
    def front_turn(s, p):
        sol = p.sol; fr = sol.fr
        if fr is not s.front or sol.status != 'front':          # война кончилась без него — домой
            p.inst = None; return
        # отпуск по ранению: ход дома, потом обратно
        if sol.leave:
            sol.leave = False; p.inst = None; p.turns -= 1; s.stats['war_leave_turn'] += 1
            ORIG_STEP(s, p)
            if p.alive and not p.done and p.inst is None and s.front is fr and p.seg in (2, 3) and fr.side_of(p.cidx) == sol.side:
                p.inst = 'Фронт'
            else:
                s.off_front(sol, 'left')
            return
        # 1. фишка идёт по полю жизни; клетки не играются
        p.cell += d6(); seglen = 30 + (2 if 1 <= p.seg <= 4 else 0)
        if p.cell >= seglen:
            p.seg += 1; p.cell -= seglen; s.seg_enter(p, p.seg)
            if not p.alive: return s.off_front(sol, 'dead_age')
            if p.seg >= 4: return s.off_front(sol, 'demob')
        p.stazh += 1; sol.turns += 1; s.stats['war_turn'] += 1; p.log['war_turns'] += 1
        c = s.countries[p.cidx]
        if c['ideo'] in PAID: p.vozm += 1
        fr.refresh(); sol.pull()
        # 2. тактика и атака
        sol.tac = WS.tactic(sol); s.stats['tac_' + sol.tac] += 1
        if sol.tac == 'атака':
            fr.W.attack(sol.side, sol)
        if s.war_health(sol): return
        if fr.W.over is not None: return s.end_war(fr.W.over)
        # 3. событие клетки, где метка, — со своего края
        cell = fr.W.cell(sol.side)
        if cell <= -7: cell = -6
        e = random.choice(WS.BY_CELL[cell])
        tags = ' '.join('#' + t for t in e['tags'])
        s.stats['war_event'] += 1
        s.run_p(sol.off and e['off'] or e['body'], sol, tags)
        if sol.status != 'front': return s.leave_status(sol)
        if s.war_health(sol): return
        if sol.tac == 'беречь' and d6() <= 2: fr.W.move(sol.side, -1)
        if fr.W.over is not None: return s.end_war(fr.W.over)

    def run_p(s, parts, sol, tags):
        p = sol.p; fr = sol.fr; st = s.stats
        for a in parts:
            if sol.status != 'front': return
            k = a[0]
            if k == 'ph':
                n = a[1]
                if n < 0:
                    n = min(0, n + (WS.OFF_DMG if sol.off else 0) + (WS.SAVE_DMG if sol.tac == 'беречь' else 0))
                    if n <= -3 and sol.bf:                     # «Боевые друзья»: отменить одну потерю физ.
                        p.items['Боевые друзья'] -= 1; sol.bf = p.items['Боевые друзья'] > 0; st['bf_cancel'] += 1; n = 0
                p.phys = max(-10, min(10, p.phys + n))
            elif k == 'ps': p.psy = max(-10, min(10, p.psy + a[1]))
            elif k == 'v': p.vozm += a[1]
            elif k == 'st':
                if a[2] > 0: p.st[a[1]] = max(p.st[a[1]], min(7, p.st[a[1]] + a[2]))
                else: p.st[a[1]] = max(0, p.st[a[1]] + a[2])
            elif k == 'ch': CH.step(p, a[1])
            elif k == 'trump':
                p.add_item(a[1], 'козырь'); st['war_trump'] += 1
                if a[1] == 'Боевые друзья': sol.bf = True
            elif k == 'link': p.add_item(a[1], 'связь'); st['war_link'] += 1
            elif k == 'stig': p.add_item(a[1], 'стигма')
            elif k == 'jr':
                if not p.items.get('Кровь на руках', 0): p.items['Кровь на руках'] = 1; p.itype['Кровь на руках'] = 'журнал'; st['war_blood'] += 1
            elif k == 'award':
                if sol.tac == 'атака': p.pos_ = min(3, p.pos_ + 1); sol.awards += 1; st['war_award'] += 1
            elif k == 'front': fr.W.move(sol.side, a[1])
            elif k == 'coh': p.coh = max(-3, min(3, p.coh + a[1]))
            elif k == 'leave': sol.leave = True; st['war_leave'] += 1
            elif k == 'captive': sol.status = 'captive'
            elif k == 'prison': sol.status = 'tribunal'; sol.prison_kind = a[1]
            elif k == 'rank_lost': p.items['Офицерское звание'] = 0; sol.off = False; st['war_rank_lost'] += 1
            elif k in ('nothing', 'note'): pass
            elif k == 'chk':
                _, stat, t, succ, fail = a
                r = roll3(1 if p.predisp == stat else 0) + p.st.get(stat, 4) + CH.mod(p, tags)
                ok = r >= t
                if not ok and sol.bf and r + 5 >= t and WS.ev(fail, sol) <= -2:   # «Боевые друзья»: +5 к проверке
                    p.items['Боевые друзья'] -= 1; sol.bf = p.items['Боевые друзья'] > 0; ok = True; st['bf_check'] += 1
                st['war_chk'] += 1; st['war_chk_ok'] += ok
                s.run_p(succ if ok else fail, sol, tags)
            elif k == 'd6':
                r = d6()
                for (lo, hi), pp in a[1]:
                    if lo <= r <= hi: s.run_p(pp, sol, tags)
            elif k == 'opt':
                o = WS.choose(sol, a[1], st); s.run_p(o[2], sol, tags)
            elif k == 'ifs':
                for cnd, pp in a[1]:
                    if WS.cond(cnd, sol): s.run_p(pp, sol, tags); break
                else: s.run_p(a[2], sol, tags)
            else: raise ValueError(a)

    def war_health(s, sol):
        """Комиссия на −8…−9, гибель на −10 (психика — d6 на психбольницу). True — солдат ушёл с фронта."""
        p = sol.p
        if sol.status != 'front': return True
        c = s.countries[p.cidx]
        if p.phys <= -10:
            s.war_death(sol, 'физ (война)'); return True
        if p.psy <= -10:
            lim = {'ядро': 4, 'полупериферия': 3, 'периферия': 1}[c['pos']] + (1 if c['ideo'] == 'Социал-демократия' else 0)
            if d6() <= lim:
                p.psy = -8; s.off_front(sol, 'psyhosp'); p.enter('Психбольница', 6); s.stats['psych_saved'] += 1
            else:
                s.war_death(sol, 'психика (война)')
            return True
        if p.phys <= -8 or p.psy <= -8:
            tp, tq = TREAT[c['ideo']]
            kind = 'comm_phys' if p.phys <= -8 else 'comm_psy'
            s.off_front(sol, kind)
            if p.phys <= -8 and tp: p.phys = min(10, p.phys + tp); s.stats['war_treat_phys'] += 1
            if p.psy <= -8:
                if tq == 'ward': p.no_uchet = True; p.enter('Психбольница', 6); s.stats['war_treat_ward'] += 1
                elif tq: p.psy = min(10, p.psy + tq); s.stats['war_treat_psy'] += 1
            return True
        return False

    def war_death(s, sol, why):
        p = sol.p; c = s.countries[p.cidx]
        b = DEATH_BEN.get(c['ideo'], {})
        p.vozm += b.get('v', 0); p.pos_ = min(3, p.pos_ + b.get('pos', 0)); p.coh = min(3, p.coh + b.get('coh', 0))
        s.off_front(sol, 'dead'); p.die(why)

    def leave_status(s, sol):
        p = sol.p
        if sol.status == 'captive':
            s.off_front(sol, 'captive'); p.no_sud = True; p.enter('Тюрьма', random.randint(1, 3))
        elif sol.status == 'tribunal':
            s.off_front(sol, 'tribunal'); heavy = getattr(sol, 'prison_kind', 'лёгкое') == 'тяжёлое'
            p.enter('Тюрьма', random.randint(1, 3) + (3 if heavy and random.random() < 0.4 else 0))

    def off_front(s, sol, how):
        p = sol.p
        sol.status = how; s.stats['war_out_' + how] += 1
        if p.inst == 'Фронт': p.inst = None
        p.war_done = sol.fr.id
        s.enlist.append(dict(out=how, turns=sol.turns, dph=p.phys - sol.ph0, dps=p.psy - sol.ps0, awards=sol.awards,
                             pos=s.countries[p.cidx]['pos'], ideo=s.countries[p.cidx]['ideo'], cls=p.cls, off=sol.off))

    def front_round(s):
        fr = s.front; fr.rounds += 1; fr.refresh()
        if INSTANT and not fr.active(): return s.instant(fr)
        for side in (0, 1):
            if fr.W.over is None and not fr.active(side):
                fr.W.attack(side); s.stats['keeper_attack'] += 1
        if fr.W.over is not None: s.end_war(fr.W.over)

    def instant(s, fr):
        """Солдат-игроков нет: d6 — 6 «Белый мир»; равные позиции 1–2 первая, 3–4 вторая, 5 перебросить; кто выше — 1–3 он, 4–5 слабый."""
        a, b = (WS.RANK[s.countries[fr.sides[k][0]]['pos']] for k in (0, 1))
        s.stats['war_instant'] += 1
        while True:
            r = d6()
            if r == 6: s.stats['war_white_peace'] += 1; return s.end_war('мир')
            if a == b:
                if r <= 4: return s.end_war(0 if r <= 2 else 1)
                continue
            strong = 0 if a > b else 1
            return s.end_war(strong if r <= 3 else 1 - strong)

    # ---------- начало войны и призыв ----------
    def pick_pair(s):
        foes = [k for k, v in s.rel.items() if v == 'вражда']
        if not foes:
            neu = [k for k, v in s.rel.items() if v == 'нейтралитет'] or list(s.rel)
            k = random.choice(neu); s.rel[k] = 'вражда'; s.stats['war_new_enmity'] += 1; return k
        return random.choice(foes)

    def start_war(s, kind):
        a, b = s.pick_pair()
        sides = {0: [a], 1: [b]}
        if kind == 'world':
            for ci in range(5):
                if ci in (a, b): continue
                ra, rb = s.relation(ci, a), s.relation(ci, b)
                if ra == 'союз' and rb != 'союз': sides[0].append(ci)
                elif rb == 'союз' and ra != 'союз': sides[1].append(ci)
        fr = Front(s, sides, kind); s.front = fr; fr.declaring = True
        s.stats['war_start_' + kind] += 1
        mem = fr.members()
        for ci in mem: s.countries[ci]['stab'] -= 3 if kind == 'world' else 2
        if kind == 'world':
            for ci in range(5):
                if ci not in mem: s.countries[ci]['stab'] -= 1
        # игроки: призыв, остальные — по карте
        drafted = s.draft(fr)
        for p in s.players:
            if not p or not p.alive or p.done or p in drafted: continue
            if p.cidx in mem:
                if p.cls == 'Мафия': p.vozm += 2
                else:
                    p.vozm -= 2; p.psy -= 1
                    if s.countries[p.cidx]['pos'] == 'периферия': p.phys -= 2
                    p.check_death('война')
            elif kind == 'world':
                p.vozm += 2; p.psy -= 1; p.check_death('война')
        if kind == 'world':
            for ci in mem:
                if s.front is fr: s.crisis_now(ci)
        if s.front is fr: s.volunteers(fr)
        fr.declaring = False
        for p in s.players:
            if p and p.alive and not p.done and p.cidx in mem: p.log['war_home'] += 1
        if s.front is fr and INSTANT and not fr.active(): s.instant(fr)
        for ci in mem: s.flight_chance(ci, 'war')

    def volunteers(s, fr):
        """Военные (класс Армия или «Присяга») уходят добровольцами: за свою страну или её союзника, иначе за сторону, не враждебную своей стране."""
        for p in s.players:
            if not p or not p.alive or p.done or p.inst or p.seg not in (2, 3) or getattr(p, 'war_done', None) == fr.id: continue
            if not (p.cls == 'Армия' or p.items.get('Присяга', 0) > 0): continue
            if random.random() >= VOLUNTEER: continue
            side = fr.side_of(p.cidx)
            if side is None:
                ok = [k for k in (0, 1) if any(s.relation(p.cidx, ci) == 'союз' for ci in fr.sides[k])]
                if not ok: ok = [k for k in (0, 1) if not any(s.relation(p.cidx, ci) == 'вражда' for ci in fr.sides[k])]
                if not ok: continue
                side = random.choice(ok)
            p.inst = 'Фронт'; p.inst_left = 99
            sol = Sol(p, fr, side); p.sol = sol; fr.sols.append(sol)
            p.log['war'] += 1; s.stats['volunteer'] += 1

    def draft(s, fr):
        out = []
        for p in s.players:
            if not p or not p.alive or p.done or p.inst or p.seg not in (2, 3): continue
            side = fr.side_of(p.cidx)
            if side is None or p.cidx not in p.citizen or getattr(p, 'war_done', None) == fr.id: continue
            c = s.countries[p.cidx]
            pt = PATR.get(c['cult'], 0)
            if (pt > 0 and p.female) or (pt < 0 and not p.female): continue
            cls, ideo = p.cls, c['ideo']
            if cls == 'Олигархи': continue
            if ideo in ('Либеральная демократия', 'Вольница') and cls != 'Армия' and fr.W.cell(side) > -3: continue
            if cls == 'Армия': go = True
            elif cls == 'Народ': go = d6() <= (5 if ideo in WIDE else 4)
            else: go = d6() <= (3 if ideo in WIDE else 2)
            if not go: continue
            used = False
            for k in ('Справка', 'Друг в Генштабе'):
                if p.items.get(k, 0) > 0: p.items[k] -= 1; s.stats['draft_free_' + k] += 1; used = True; break
            if used: continue
            if cls == 'Мафия':
                cost = 1 if ideo == 'Клептократия' else 3
                if p.vozm >= cost: p.vozm -= cost; s.stats['draft_buyout'] += 1; continue
            p.inst = 'Фронт'; p.inst_left = 99
            sol = Sol(p, fr, side); p.sol = sol; fr.sols.append(sol); out.append(p)
            p.log['war'] += 1; s.stats['drafted'] += 1; s.stats['drafted_' + cls] += 1
        return out

    # ---------- конец войны ----------
    def end_war(s, how):
        fr = s.front
        if fr is None: return
        s.front = None
        peace = how == 'мир'
        s.wars.append(dict(kind=fr.kind, rounds=fr.rounds, peace=peace, wts=s.wt - fr.start_wt, soldiers=len(fr.sols),
                           win_pos=None if peace else s.countries[fr.sides[how][0]]['pos'],
                           lose_pos=None if peace else s.countries[fr.sides[1 - how][0]]['pos'],
                           win_ideo=None if peace else s.countries[fr.sides[how][0]]['ideo']))
        for sol in fr.sols:
            if sol.status != 'front': continue
            p = sol.p
            if peace or not p.alive: s.off_front(sol, 'home'); continue
            if sol.side == how:
                e = random.choice(WS.BY_CELL[7]); s.run_p(sol.off and e['off'] or e['body'], sol, '#война')
                if sol.status != 'front': s.leave_status(sol); continue
                if not s.war_health(sol): s.off_front(sol, 'home')
            else:
                if d6() == 1:
                    sol.status = 'captive'; s.leave_status(sol); s.stats['war_rout_captive'] += 1
                else:
                    p.psy -= 1; s.off_front(sol, 'home'); p.check_death('война')
        if peace:
            for ci in fr.members(): s.countries[ci]['stab'] = min(10, s.countries[ci]['stab'] + 1)
            return
        win, lose = fr.sides[how], fr.sides[1 - how]
        lead = s.countries[win[0]]
        for ci in lose:
            s.countries[ci]['stab'] -= 2; s.crisis_now(ci)
        for ci in win: s.countries[ci]['stab'] = min(10, s.countries[ci]['stab'] + 1)
        for ci in lose: s.war_outcome(win[0], ci)

    def war_outcome(s, wi, li):
        W_, L = s.countries[wi], s.countries[li]
        r = d6()
        res = 'occupation' if r >= 5 else 'regime' if r >= 3 else 'plunder' if r == 2 else 'genocide'
        if res == 'genocide' and not (W_['ideo'] == 'Национализм' and L['minor'] >= 1):
            res = 'plunder' if W_['ideo'] in ('Клептократия', 'Военная диктатура') else 'occupation'
        if res == 'plunder' and W_['ideo'] in ('Либеральная демократия', 'Социал-демократия'): res = 'regime'
        s.outcomes[res] += 1; s.stats['war_outcome_' + res] += 1
        if res in ('occupation', 'regime'): s.tribunal(li)
        if res == 'occupation':
            L['stab'] -= 3; W_['stab'] = min(10, W_['stab'] + 1); L['occ'] = s.wt + 1
            for p in s.players:
                if not p or not p.alive or p.done or p.cidx != li: continue
                p.vozm -= 2
                if random.random() < 0.5: p.vozm += 1; p.occ_side = 'collab'; s.stats['occ_collab'] += 1
                else:
                    p.occ_side = 'resist'; p.phys -= 1; s.stats['occ_resist'] += 1
                    if d6() == 1 and p.inst is None: p.enter('Тюрьма', random.randint(1, 3) + (3 if random.random() < 0.4 else 0))
                    p.check_death('оккупация')
        elif res == 'regime':
            old_dom = L['dom']
            L['ideo'] = W_['ideo']; L['dom'] = W_['dom']
            if sim3.CONF_RULE: L['conflict'] = s.against(L['ideo'], L['cult'])
            L['ali'] = old_dom if old_dom != L['dom'] else roll_ali(L['ideo'], L['dom'])
            L['stab'] = 4; L['changes'] += 1; L['doms'].append(L['dom'])
            s.smuta(li)
        elif res == 'plunder':
            if PRANK[L['pos']] > PRANK[W_['pos']]: L['pos'], W_['pos'] = W_['pos'], L['pos']
            else: L['pos'] = POS_ORDER[max(0, PRANK[L['pos']] - 1)]
        elif res == 'genocide':
            s.genocide(wi, li)

    def tribunal(s, li):
        for p in s.players:
            if p and p.alive and not p.done and p.cidx == li and p.items.get('Кровь на руках', 0) and p.inst is None:
                s.stats['blood_tribunal'] += 1
                if roll3(1 if p.predisp == 'Смекалка' else 0) + p.st['Смекалка'] < 15:
                    p.enter('Тюрьма', random.randint(1, 3) + (3 if random.random() < 0.4 else 0)); s.stats['blood_prison'] += 1

    def genocide(s, wi, li):
        L = s.countries[li]; m = L['minor']
        g = random.randint(1, m + 1)                      # меньшинства 1…m, основная группа — последней
        major = g == m + 1
        s.stats['genocide_major' if major else 'genocide_minor'] += 1
        victims = []
        for p in s.players:
            if not p or not p.alive or p.done or p.cidx != li: continue
            if major and not p.minority: victims.append(p)
            elif not major and p.minority and (hash(p.culture) % m) + 1 == g: victims.append(p)
        for p in victims:
            p.phys -= 3; p.vozm -= 3
            if roll3(1 if p.predisp == 'Ловкость' else 0) + p.st['Ловкость'] < 15: p.phys -= 3
            p.check_death('геноцид')
            if not p.alive: continue
            if p.inst == 'Фронт': s.off_front(p.sol, 'home')
            if p.inst: continue
            dest = [ci for ci in range(5) if ci != li and s.countries[ci]['ideo'] != 'Национализм' and not (s.front and ci in s.front.members())]
            s.stats['refugee'] += 1; p.log['refugee'] += 1
            if dest: s.arrive(p, random.choice(dest), True, 'flight', 'геноцид')
            else: s.arrive(p, random.choice([ci for ci in range(5) if ci != li]), False, 'flight', 'геноцид'); s.stats['refugee_scattered'] += 1
        if major:
            L['pos'] = POS_ORDER[max(0, PRANK[L['pos']] - 1)]
            for p in s.players:
                if p and p.alive and p.cidx == li and p.minority and (hash(p.culture) % max(1, m)) + 1 == 1: p.minority = False
        L['minor'] = max(0, m - 1)
        for p in s.players:
            if p and p.alive and not p.done and p.cidx == wi and p.cls in ('Полиция', 'Мафия', 'Олигархи'): p.vozm += 2
        s.countries[wi]['embargo'] = True

    # ---------- кризис и смена власти ----------
    def crisis_now(s, ci):
        c = s.countries[ci]
        if roll3() >= 8 + c['stab']:
            c['crises'] += 1; s.stats['crisis'] += 1; s.stats['crisis_now'] += 1
            if roll3() >= 11: s.power_change(ci)
            else: c['stab'] = min(STAB_CAP.get(c['ideo'], 10), c['stab'] + 2)

    def power_change(s, ci):
        c = s.countries[ci]
        c['changes'] += 1; s.stats['power_change'] += 1
        old_dom, old_ali = c['dom'], c['ali']
        if BIND:
            opts = list(COUP[old_ali])
            if old_ali == 'Народ' and sim3.CONF_RULE and s.cprof[c['cult']][4] == -2: opts.append('Теократия')   # сильно теистичная культура
            c['ideo'] = random.choice(opts)
            c['dom'] = old_ali if old_ali in CLOSE[c['ideo']] else by_tab(DOM[c['ideo']])
            if d6() <= 3 and old_dom != c['dom']: c['ali'] = old_dom
            else: c['ali'] = roll_ali(c['ideo'], c['dom'])
        else:
            c['dom'], c['ali'] = old_ali, old_dom
            c['ideo'] = random.choice(COUP[c['dom']])
        c['stab'] = 4; c['doms'].append(c['dom']); c['embargo'] = False
        if sim3.CONF_RULE: c['conflict'] = s.against(c['ideo'], c['cult'])
        s.coups.append((ci, old_dom, c['dom'], len(c['doms']) >= 3 and c['doms'][-1] == c['doms'][-3], len(c['doms']) >= 3))
        s.smuta(ci)
        s.flight_chance(ci, 'power')
        fr = s.front
        if fr and ci in fr.members() and (random.random() < START_PEACE if getattr(fr, 'declaring', False) else d6() >= 4):   # новая власть просит мира
            if ci in (fr.sides[0][0], fr.sides[1][0]):
                s.stats['war_peace_coup'] += 1; s.end_war('мир')
            else:                                                   # член коалиции выходит из войны
                side = fr.side_of(ci); fr.sides[side].remove(ci); s.stats['war_exit_coup'] += 1
                for sol in fr.sols:
                    if sol.status == 'front' and sol.p.cidx == ci: s.off_front(sol, 'home')

    def smuta(s, ci):
        c = s.countries[ci]
        for p in s.players:
            if p and p.alive and not p.done and p.cidx == ci:
                card = random.choice(DECK['Смута']); s.stats['smuta_card'] += 1; s.cur_card = 'Смута | ' + str(card.get('Карта')); s.cur_full = ''
                wn = p.wants
                if wn and 'side' in wn['flags']: side = random.choice(['Победители', 'Проигравшие'])
                else: side = random.choice(['Победители', 'Проигравшие', 'Нейтралы', 'Нейтралы'])
                cls0 = p.cls; keep = {k: p.items.get(k, 0) > 0 for k in ('Присяга', 'Значок')}
                exec_text(card.get('Для всех', ''), p, s, p.seg); exec_text(card.get(side, ''), p, s, p.seg)
                txt = ' '.join(str(v) for v in card.values())
                if c['ideo'] in HARSH_I and 'не действует' not in txt and p.inst is None and p.alive:
                    lose = side == 'Проигравшие' or (side == 'Нейтралы' and (sim3.SMUTA_N == 'all' or c['ideo'] == 'Военная диктатура') and roll3() + p.st['Смекалка'] < 12)
                    if lose: p.enter('Тюрьма', random.randint(1, 3)); s.stats['prison_smuta'] += 1
                p.smuta_lost = side == 'Проигравшие'
                if p.alive:
                    p.log['pc'] += 1
                    if side == 'Победители': p.log['smuta_win'] += 1
                    if side == 'Проигравшие': p.log['smuta_lose'] += 1
                    if side != 'Нейтралы': p.log['smuta_side'] += 1
                    if p.cls == cls0: p.log['pc_keep_class'] += 1
                    if p.vozm >= 5: p.log['pc_vozm5'] += 1
                    for k, v in keep.items():
                        if v and p.items.get(k, 0) > 0: p.log['pc_keep_' + k] += 1

    # ---------- мировой ход ----------
    def world_turn(s):
        s.stats['world_turns'] += 1; s.wt += 1
        for c in s.countries: c['war'] = False
        fr = s.front
        if fr:
            fr.W.world_turn(); s.stats['wt_at_war'] += 1
            for ci in fr.members():
                s.countries[ci]['war'] = True; s.countries[ci]['stab'] -= 1
            for p in s.players:
                if p and p.alive and not p.done and fr.side_of(p.cidx) is not None and p.seg >= 2:
                    p.vozm += 1 if p.cls == 'Мафия' else -1
                    p.log['war_home'] += 1
        # конец оккупации, эмбарго исполнителей геноцида
        for ci, c in enumerate(s.countries):
            if c['occ'] is not None and s.wt > c['occ']:
                c['occ'] = None
                for p in s.players:
                    if not p or not p.alive or p.done or p.cidx != ci: continue
                    sd = getattr(p, 'occ_side', None)
                    if sd == 'collab' and d6() <= 2: p.add_item('Дурная слава', 'стигма')
                    if sd == 'resist': p.pos_ = min(3, p.pos_ + 1)
                    p.occ_side = None
            if c['embargo']:
                for p in s.players:
                    if p and p.alive and not p.done and p.cidx == ci and p.seg >= 2: p.vozm += 2 if p.cls == 'Мафия' else -1
        for ci, c in enumerate(s.countries):
            s.stats['T_n'] += 1; s.stats['T_dom_' + c['dom']] += 1; s.stats['T_ali_' + c['ali']] += 1; s.stats['T_ideo_' + c['ideo']] += 1
            s.stats['T_conf'] += 1 if c['conflict'] else 0; s.stats['T_stab'] += c['stab']
            if roll3() >= 8 + c['stab']:
                c['crises'] += 1; s.stats['crisis'] += 1
                if roll3() >= 11: s.power_change(ci)
                else: c['stab'] = min(STAB_CAP.get(c['ideo'], 10), c['stab'] + 2)
            else:
                c['stab'] = min(STAB_CAP.get(c['ideo'], 10), c['stab'] + 1 - (1 if c['conflict'] else 0) - (1 if c['ali'] == 'Народ' else 0))
        pool = [x for x in DECK['Мир'] if x.get('Карта') not in THAW]
        while True:
            card = random.choice(pool); nm = card.get('Карта')
            if WAR == 'front' and nm in ('Война', 'Мировая война') and s.front: s.stats['war_card_redraw'] += 1; continue
            break
        s.gstat[nm] += 1; s.stats['world_' + card.get('Охват', '?')] += 1
        s.cur_card = 'Мир | ' + str(nm); s.cur_full = ''
        if WAR == 'front' and nm in ('Война', 'Мировая война'):
            s.start_war('world' if nm == 'Мировая война' else 'local')
        elif WAR == 'front' and 'мирный договор' in nm.lower() and s.front:
            s.stats['war_peace_treaty'] += 1
            mem = s.front.members(); s.end_war('мир')
            for p in s.players:
                if p and p.alive and not p.done and p.cidx in mem: p.psy += 1
        else:
            ci = random.randrange(5)
            if WAR == 'old':
                if nm == 'Война': s.countries[ci]['war'] = True
                if nm == 'Мировая война':
                    for c in s.countries:
                        if c['conflict'] or random.random() < 0.5: c['war'] = True
            m = re.search(r'стабильность\s*([+−-])\s?(\d)', card.get('Страна', ''))
            if m: s.countries[ci]['stab'] += int(m.group(2)) * (1 if m.group(1) == '+' else -1)
            for p in s.players:
                if p and p.alive and not p.done and (card.get('Охват', '') != 'местный' or p.cidx == ci):
                    exec_text(card.get('Игроки', ''), p, s, p.seg)
                    if nm in ('Пандемия', 'Мировая война') and p.alive: p.log['global'] += 1
            if WAR == 'old':
                for p in s.players:
                    if p and p.alive and not p.done and p.seg >= 2 and s.countries[p.cidx]['war']: p.log['war'] += 1
                for cj, c in enumerate(s.countries):
                    if c['war']: s.flight_chance(cj, 'war')
            if nm == 'Чистка': s.flight_chance(ci, 'purge')
        # призыв в каждый мировой ход, пока идёт война
        if WAR == 'front' and s.front and fr is s.front:
            s.draft(s.front); s.volunteers(s.front)
            for ci in s.front.members(): s.flight_chance(ci, 'war')


# =====================================================================
def run_games(N, rounds):
    lives, wars, enl, coups = [], [], [], []
    tot = C.Counter(); outc = C.Counter(); wts = 0
    for g in range(N):
        w = World2(rounds).run()
        tot.update(w.stats); outc.update(w.outcomes); wts += w.wt
        lives.extend(w.lives); wars.extend(w.wars); enl.extend(w.enlist); coups.extend(w.coups)
        if w.front: wars.append(dict(kind=w.front.kind, rounds=w.front.rounds, peace=None, wts=w.wt - w.front.start_wt, soldiers=len(w.front.sols)))
    return dict(lives=lives, wars=wars, enl=enl, coups=coups, tot=tot, outc=outc, N=N, wts=wts)


def pc(a, b): return 100.0 * a / b if b else 0.0


def report(R, title):
    L = R['lives']; n = len(L); t = R['tot']; N = R['N']
    hap = [p.happy for p in L]
    print('== %s · партий %d, жизней %d' % (title, N, n))
    print('счастье %.2f · до Древности %.1f%% · умерли в Молодости–Зрелости %.1f%%' % (
        S.mean(hap), pc(sum(1 for p in L if p.maxseg == 5), n), pc(sum(1 for p in L if p.death and p.death[0] in ('Молодость', 'Зрелость')), n)))
    dc = C.Counter((p.death[1].split(' (')[0] + (' (война)' if 'война' in p.death[1] else '')) for p in L if p.death)
    print('причины смерти: ' + ', '.join('%s %.1f%%' % (k, pc(v, n)) for k, v in dc.most_common(8)))
    dr = [p for p in L if p.log['war'] > 0]
    nd = [p for p in L if p.log['war'] == 0 and p.maxseg >= 2]
    print('побывали на войне %.1f%% жизней · счастье прошедших войну %.2f, остальных (дожили до Молодости) %.2f' % (
        pc(len(dr), n), S.mean(p.happy for p in dr) if dr else float('nan'), S.mean(p.happy for p in nd) if nd else float('nan')))
    W_ = [w for w in R['wars'] if w['peace'] is not None]
    if W_:
        rr = [w['rounds'] for w in W_]
        print('войн за партию %.2f (мировых %.2f) · длительность %.1f круга (медиана %d) · миром %.0f%% · мировых ходов с войной %.0f%%' % (
            len(R['wars']) / N, sum(1 for w in R['wars'] if w['kind'] == 'world') / N, S.mean(rr), S.median(rr),
            pc(sum(1 for w in W_ if w['peace']), len(W_)), pc(t['wt_at_war'], R['wts'])))
        print('солдат-игроков на войну %.2f · удары хранителя %.1f на войну' % (S.mean(w['soldiers'] for w in W_), t['keeper_attack'] / max(1, len(R['wars']))))
        vic = [w for w in W_ if not w['peace']]
        print('победы по позиции: ' + ', '.join('%s %.0f%%' % (k, pc(sum(1 for w in vic if w['win_pos'] == k), sum(1 for w in vic if w['win_pos'] == k) + sum(1 for w in vic if w['lose_pos'] == k))) for k in ('ядро', 'полупериферия', 'периферия')))
    E_ = R['enl']
    if E_:
        oc = C.Counter(e['out'] for e in E_)
        print('призывов %d (%.2f на партию) · ходов на фронте %.1f · исходы: %s' % (len(E_), len(E_) / N, S.mean(e['turns'] for e in E_),
              ', '.join('%s %.1f%%' % (k, pc(v, len(E_))) for k, v in oc.most_common())))
        print('Δфиз %.2f · Δпсих %.2f · наград %.2f · «Кровь на руках» %d · призваны по классам: %s' % (
            S.mean(e['dph'] for e in E_), S.mean(e['dps'] for e in E_), S.mean(e['awards'] for e in E_), t['war_blood'],
            ', '.join('%s %d' % (k[8:], v) for k, v in t.items() if k.startswith('drafted_'))))
        print('освобождены: справка/друг %d, откуп Мафии %d' % (t['draft_free_Справка'] + t['draft_free_Друг в Генштабе'], t['draft_buyout']))
    if R['outc']: print('итоги войн: ' + ', '.join('%s %d' % (k, v) for k, v in R['outc'].most_common()) + ' · беженцев %d' % t['refugee'])
    cp = R['coups']
    if cp:
        rep = [x for x in cp if x[4]]
        print('смен власти за партию %.2f · «качели»: повторная смена вернула прежний класс в %.0f%% случаев · мир после смены власти %d, выход из коалиции %d' % (
            len(cp) / N, pc(sum(1 for x in rep if x[3]), len(rep)), t['war_peace_coup'], t['war_exit_coup']))


if __name__ == '__main__':
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    random.seed(int(E('SEED', '1')))
    report(run_games(N, rounds), 'WAR=%s BIND=%d' % (WAR, BIND))
