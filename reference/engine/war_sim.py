"""Симуляция фронта: одна война двух стран, солдаты-игроки из снимков sim3, хранитель за пустые стороны.

Запуск: python3 war_sim.py [N войн] — печатает длительность войн, исходы для солдат и средние по клеткам.
Параметры среды: P0/P1/P2 — доля сторон с 0/1/2 солдатами-игроками; PEACE — шанс мира в мировой ход.
"""
import json, random, os, sys, statistics as S
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import war_data as W

E = os.environ.get
SNAPS = None                              # снимки игроков из sim3 (war_snaps.py) — грузятся при первой войне
HERE = os.path.dirname(os.path.abspath(__file__))
P_SOLD = [float(E('P0', '0.45')), float(E('P1', '0.40')), float(E('P2', '0.15'))]
PEACE = float(E('PEACE', '0.10'))
OFF_DMG = int(E('OFF_DMG', '1'))          # офицер: каждая потеря физ. на 1 меньше
SAVE_DMG = int(E('SAVE_DMG', '1'))        # «Беречь себя»: то же
ATK_LOSS = int(E('ATK_LOSS', '1'))        # сорванная атака (итог ≤ 1): −1 физ.
COMM = int(E('COMM', '-8'))               # комиссия при −8 и ниже
HOLY = int(E('HOLY', '1'))                # перебросов «Священной войны» на мировой ход
POSMOD = {'ядро': 0, 'полупериферия': 0, 'периферия': 0}    # поправка к d6 атаки по позиции (до 14.11: ядро +1, периферия −1)
ADVSTRONG = True     # сторона с позицией выше бросает d4 шагов с преимуществом каждую вторую свою атаку (14.11)
POSDIFF = False      # True — +1 к d6 только стороне с позицией выше, чем у противника (POSMOD не действует)
D4ADV = set()        # позиции, которые бросают d4 шагов с преимуществом (два d4, берут больший)
RANK = {'периферия': 0, 'полупериферия': 1, 'ядро': 2}

AX = [('Самолюбие', 'Скромность'), ('Хватка', 'Щедрость'), ('Влюбчивость', 'Верность'), ('Соперничество', 'Участие'),
      ('Аппетит', 'Мера'), ('Вспыльчивость', 'Выдержка'), ('Беспечность', 'Усердие')]
POLE = {}
for i, (a, b) in enumerate(AX): POLE[a] = (i, 1); POLE[b] = (i, -1)
DAT = {'Самолюбию': 'Самолюбие', 'Скромности': 'Скромность', 'Хватке': 'Хватка', 'Щедрости': 'Щедрость', 'Влюбчивости': 'Влюбчивость',
       'Верности': 'Верность', 'Соперничеству': 'Соперничество', 'Участию': 'Участие', 'Аппетиту': 'Аппетит', 'Мере': 'Мера',
       'Вспыльчивости': 'Вспыльчивость', 'Выдержке': 'Выдержка', 'Беспечности': 'Беспечность', 'Усердию': 'Усердие'}
BY_CELL = defaultdict(list)
for e in W.EV: BY_CELL[e['cell']].append(e)

def d(n): return random.randint(1, n)
def r3(): return d(6) + d(6) + d(6)
P15 = {}
def p_ge(t):
    if t not in P15:
        c = sum(1 for a in range(1, 7) for b in range(1, 7) for x in range(1, 7) if a + b + x >= t); P15[t] = c / 216
    return P15[t] if t > 3 else 1.0

def has(s, gate):
    strong = gate.split()[0] in ('сильное', 'сильная', 'сильный')
    pole = gate.split()[-1]
    a, sg = POLE[pole]; v = s.char[a]
    return v * sg == 2 if strong else v * sg > 0

class Soldier:
    def __init__(s, snap, side):
        s.phys, s.psy, s.vozm = snap['phys'], snap['psy'], snap['vozm']
        s.st = dict(snap['st']); s.char = list(snap['char']); s.cls = snap['cls']
        s.off = snap['off'] or (snap['cls'] == 'Армия' and snap['seg'] == 3 and random.random() < 0.25)
        s.bf = snap['bf']; s.mate = snap['mate']; s.pos = snap['pos']
        s.side = side; s.status = 'front'; s.turns = 0; s.awards = 0; s.blood = 0; s.leave = False; s.tac = None
        s.ph0, s.ps0 = s.phys, s.psy; s.links = 0; s.trumps = 0; s.v0 = s.vozm

# ---------- оценка вариантов для выбора ----------
def ev(parts, s):
    t = 0.0
    for p in parts:
        k = p[0]
        if k == 'ph': t += p[1] if p[1] > 0 else min(0, p[1] + (OFF_DMG if s.off else 0) + (SAVE_DMG if s.tac == 'беречь' else 0))
        elif k == 'ps': t += p[1]
        elif k == 'v': t += 0.33 * p[1]
        elif k == 'award': t += 1.5 if s.tac == 'атака' else 0
        elif k in ('trump', 'link'): t += 1.0
        elif k == 'jr': t -= 0.5
        elif k == 'prison': t -= 6
        elif k == 'captive': t -= 4
        elif k == 'rank_lost': t -= 2
        elif k == 'front': t += 0.5 * p[1]
        elif k == 'chk':
            q = p_ge(p[2] - s.st.get(p[1], 4)); t += q * ev(p[3], s) + (1 - q) * ev(p[4], s)
        elif k == 'd6':
            for (a, b), pp in p[1]: t += (b - a + 1) / 6 * ev(pp, s)
        elif k == 'opt':
            t += max(ev(o[2], s) for o in p[1])
        elif k == 'ifs':
            for c, pp in p[1]:
                if cond(c, s): t += ev(pp, s); break
            else: t += ev(p[2], s)
    return t

def cond(c, s):
    k = c[0]
    if k == 'char': return has(s, c[1])
    if k == 'char!': return has(s, 'сильное ' + c[1])
    if k == 'off': return s.off
    if k == 'ideo': return s.war.ideo[s.side] in c[1]
    if k == 'pos': return s.pos == c[1]
    if k == 'item': return s.bf
    if k == 'tac': return s.tac == c[1]
    if k == 'mate': return s.mate
    if k == 'cls': return s.cls == c[1]
    raise ValueError(c)

def choose(s, options, stats):
    forced = [o for o in options if any(has(s, g) for g in o[1])]
    pool = forced or options
    if forced: stats['forced'] += 1
    else: stats['free'] += 1
    if len(pool) == 1: return pool[0]
    if random.random() < 0.3: return random.choice(pool)
    return max(pool, key=lambda o: ev(o[2], s) + random.uniform(-0.3, 0.3))

def run(parts, s, w, stats):
    for p in parts:
        if s.status != 'front' and p[0] not in ('note',): return
        k = p[0]
        if k == 'ph':
            n = p[1]
            if n < 0:
                n = min(0, n + (OFF_DMG if s.off else 0) + (SAVE_DMG if s.tac == 'беречь' else 0))
            s.phys = max(-10, min(10, s.phys + n))
        elif k == 'ps': s.psy = max(-10, min(10, s.psy + p[1]))
        elif k == 'v': s.vozm += p[1]
        elif k == 'st': s.st[p[1]] = min(7, s.st.get(p[1], 4) + p[2]) if p[2] > 0 else s.st.get(p[1], 4) + p[2]
        elif k == 'ch':
            a, sg = POLE[DAT[p[1]]]; s.char[a] = max(-2, min(2, s.char[a] + sg))
        elif k == 'trump': s.bf = True; s.trumps += 1
        elif k == 'link': s.links += 1
        elif k == 'jr': s.blood += 1; stats['blood'] += 1
        elif k == 'award':
            if s.tac == 'атака': s.awards += 1; stats['award'] += 1
        elif k == 'front': w.move(s.side, p[1])
        elif k == 'leave': s.leave = True; stats['leave'] += 1
        elif k == 'captive': s.status = 'captive'
        elif k == 'prison': s.status = 'prison'
        elif k == 'rank_lost': s.off = False; stats['rank_lost'] += 1
        elif k in ('nothing', 'note', 'coh', 'stig'): pass
        elif k == 'chk':
            _, stat, t, succ, fail = p
            ok = r3() + s.st.get(stat, 4) >= t
            if not ok and s.bf and ev(fail, s) <= -3:      # «Боевые друзья»: +5 к проверке #война
                s.bf = False; stats['bf_used'] += 1
                ok = r3() + s.st.get(stat, 4) + 5 >= t
            run(succ if ok else fail, s, w, stats)
        elif k == 'd6':
            r = d(6)
            for (a, b), pp in p[1]:
                if a <= r <= b: run(pp, s, w, stats)
        elif k == 'opt':
            o = choose(s, p[1], stats); run(o[2], s, w, stats)
        elif k == 'ifs':
            for c, pp in p[1]:
                if cond(c, s): run(pp, s, w, stats); break
            else: run(p[2], s, w, stats)
        else: raise ValueError(p)

def health(s, stats):
    if s.status != 'front': return
    if s.phys <= -10: s.status = 'dead'
    elif s.psy <= -10:
        lim = {'ядро': 4, 'полупериферия': 3, 'периферия': 1}[s.pos]
        s.status = 'psyhosp' if d(6) <= lim else 'dead_psy'
    elif s.phys <= COMM: s.status = 'comm_phys'
    elif s.psy <= COMM: s.status = 'comm_psy'

class War:
    def __init__(s, cA, cB):
        s.pos = {0: cA['pos'], 1: cB['pos']}; s.ideo = {0: cA['ideo'], 1: cB['ideo']}
        s.x = 0; s.first = {0: True, 1: True}; s.over = None; s.siege = {0: 0, 1: 0}; s.rounds = 0
        s.holy = {0: 1, 1: 1}            # переброс «Священной войны»: один на мировой ход
    def world_turn(s):
        s.holy = {0: HOLY, 1: HOLY}
    def cell(s, side):
        c = s.x if side == 0 else -s.x
        return c
    def move(s, side, n):
        if s.over is not None: return
        s.x += n if side == 0 else -n
        s.x = max(-7, min(7, s.x))
        s.check(side)
    def check(s, side):
        for att, sign in ((0, 1), (1, -1)):
            if s.x * sign >= 7:
                dfn = 1 - att
                if s.ideo[dfn] == 'Госсоциализм':      # «Ни шагу назад!»
                    if d(6) % 2 == 0: s.over = att
                    else:
                        s.siege[att] += 1
                        if s.siege[att] >= 2: s.x = 6 * sign; s.siege[att] = 0
                else: s.over = att
    def attack(s, side, sol=None):
        if s.over is not None: return
        mod = (1 if RANK[s.pos[side]] > RANK[s.pos[1 - side]] else 0) if POSDIFF else POSMOD[s.pos[side]]
        cur = s.x if side == 0 else -s.x
        if cur >= 7 and s.ideo[1 - side] == 'Госсоциализм':   # штурм города: снова чёт/нечет
            s.check(side); return
        nat = 6
        if s.ideo[side] == 'Военная диктатура' and s.first[side]:
            r = 6; s.first[side] = False
        else:
            s.first[side] = False
            nat = d(6); r = nat + mod
            if r < 4 and s.ideo[side] in ('Теократия', 'Национализм') and s.holy[side] > 0:   # «Священная война»
                s.holy[side] -= 1; nat = d(6); r = nat + mod
        if r >= 4:
            st = d(4)
            if ADVSTRONG and RANK[s.pos[side]] > RANK[s.pos[1 - side]]:
                s.advn = getattr(s, 'advn', {0: 0, 1: 0}); s.advn[side] += 1
                if s.advn[side] % 2 == 0: st = max(st, d(4))
            if s.pos[side] in D4ADV: st = max(st, d(4))
            if sol is not None and sol.off and st <= 2: st = d(4)
            s.move(side, st)
        elif nat == 1 and sol is not None and ATK_LOSS:
            sol.phys = max(-10, sol.phys - (0 if sol.off else ATK_LOSS))

def tactic(s):
    if has(s, 'сильная Вспыльчивость'): return 'атака'
    if s.phys <= -6 or s.psy <= -6:
        return random.choices(['атака', 'держать', 'беречь'], [0.2, 0.3, 0.5])[0]
    return random.choices(['атака', 'держать', 'беречь'], [0.65, 0.25, 0.10])[0]

COUNTRY_SNAP = None
def country():
    pos = random.choice(['ядро', 'полупериферия', 'полупериферия', 'периферия', 'периферия'])
    ideo = random.choice(['Либеральная демократия', 'Социал-демократия', 'Теократия', 'Национализм', 'Госсоциализм', 'Военная диктатура', 'Клептократия'])
    return dict(pos=pos, ideo=ideo)

def turn(sol, w, stats, cells):
    if sol.leave: sol.leave = False; sol.turns += 1; return
    sol.turns += 1
    sol.tac = tactic(sol)
    stats['tac_' + sol.tac] += 1
    if sol.tac == 'атака': w.attack(sol.side, sol)
    health(sol, stats)
    if w.over is not None or sol.status != 'front': return
    c = w.cell(sol.side)
    if c <= -7: c = -6            # госсоциализм держится: защитники читают «Последний рубеж»
    e = random.choice(BY_CELL[c])
    ph0, ps0 = sol.phys, sol.psy
    run(sol.off and e['off'] or e['body'], sol, w, stats)
    cells[c].append((sol.phys - ph0, sol.psy - ps0))
    health(sol, stats)
    if sol.tac == 'беречь' and d(6) <= 2: w.move(sol.side, -1)

def one_war(stats, cells, outs):
    global SNAPS
    if SNAPS is None: SNAPS = json.load(open(E('SNAPS', os.path.join(HERE, 'war_snaps.json'))))
    cA, cB = country(), country()
    w = War(cA, cB)
    sols = []
    for side, c in ((0, cA), (1, cB)):
        n = random.choices([0, 1, 2], P_SOLD)[0]
        pool = [x for x in SNAPS if x['pos'] == c['pos']] or SNAPS
        for _ in range(n):
            sol = Soldier(random.choice(pool), side); sol.war = w; sols.append(sol)
    rnd = 0
    while w.over is None and rnd < 200:
        rnd += 1
        active = [x for x in sols if x.status == 'front']
        random.shuffle(active)
        for sol in active:
            if w.over is not None: break
            turn(sol, w, stats, cells)
        for side in (0, 1):
            if w.over is None and not any(x.status == 'front' and x.side == side for x in sols):
                w.attack(side)
        if rnd % 5 == 0:
            w.world_turn()
            if w.over is None and random.random() < PEACE: w.over = 'мир'
    stats['war_rounds'] += rnd; stats['wars'] += 1
    stats['end_' + ('мир' if w.over == 'мир' else 'победа')] += 1
    for sol in sols:
        if sol.status == 'front':
            if w.over == 'мир': sol.status = 'home'
            elif w.over == sol.side:
                e = random.choice(BY_CELL[7]); sol.tac = 'атака'; run(sol.off and e['off'] or e['body'], sol, w, stats); health(sol, stats)
                if sol.status == 'front': sol.status = 'home'
            else:
                if d(6) <= int(E('ROUT_CAPT', '1')): sol.status = 'captive'; stats['captive_rout'] += 1
                else: sol.psy -= 1; sol.status = 'home'
        outs.append(dict(status=sol.status, turns=sol.turns, dph=sol.phys - sol.ph0, dps=sol.psy - sol.ps0, awards=sol.awards,
                         blood=sol.blood, off=sol.off, pos=sol.pos, ph0=sol.ph0, ps0=sol.ps0))
    return rnd

def report(N):
    stats = Counter(); cells = defaultdict(list); outs = []; durs = []
    for _ in range(N): durs.append(one_war(stats, cells, outs))
    print('войн %d · длительность: среднее %.1f круга, медиана %d, 90%% ≤ %d · мир %.0f%%' % (
        N, S.mean(durs), S.median(durs), sorted(durs)[int(0.9 * N)], 100 * stats['end_мир'] / N))
    n = len(outs)
    if not n: return stats, outs
    print('солдат-игроков %d (%.2f на войну) · ходов на фронте: среднее %.1f, медиана %d' % (n, n / N, S.mean(o['turns'] for o in outs), S.median(o['turns'] for o in outs)))
    st = Counter(o['status'] for o in outs)
    for k in ('home', 'comm_phys', 'comm_psy', 'dead', 'dead_psy', 'psyhosp', 'captive', 'prison'):
        print('  %-10s %5.1f%%' % (k, 100 * st[k] / n))
    print('  Δфиз %.2f · Δпсих %.2f · наград на солдата %.2f · «Кровь на руках» у %.1f%% · офицеров %.0f%%' % (
        S.mean(o['dph'] for o in outs), S.mean(o['dps'] for o in outs), S.mean(o['awards'] for o in outs),
        100 * sum(1 for o in outs if o['blood']) / n, 100 * sum(1 for o in outs if o['off']) / n))
    for pos in ('ядро', 'полупериферия', 'периферия'):
        oo = [o for o in outs if o['pos'] == pos]
        if oo: print('  %-14s смерть %.1f%%, комиссия %.1f%%' % (pos, 100 * sum(1 for o in oo if o['status'].startswith('dead')) / len(oo),
                                                              100 * sum(1 for o in oo if o['status'].startswith('comm')) / len(oo)))
    print('  выбор: черта решила %d, свободно %d (%.0f%% решает характер)' % (stats['forced'], stats['free'], 100 * stats['forced'] / max(1, stats['forced'] + stats['free'])))
    print('  тактика: ' + ', '.join('%s %.0f%%' % (k[4:], 100 * v / sum(vv for kk, vv in stats.items() if kk.startswith('tac_'))) for k, v in stats.items() if k.startswith('tac_')))
    print('клетка   n     Δфиз   Δпсих')
    for c in range(7, -7, -1):
        x = cells[c]
        if x: print('%+3d %-22s %5d  %+.2f  %+.2f' % (c, W.NAME[c], len(x), S.mean(a for a, b in x), S.mean(b for a, b in x)))
    return stats, outs

if __name__ == '__main__':
    random.seed(int(E('SEED', '1')))
    report(int(sys.argv[1]) if len(sys.argv) > 1 else 5000)
