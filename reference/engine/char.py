"""Характер (7 осей −2…+2) и знакомства в городе для sim3.

CHAR=1 — характер считается: модификаторы по тегам, сдвиги из карт, Аппетит −1 физ. за отрезок.
ACQ=1  — знакомства: ▲ вместо малого обмена, колоды зданий, «Знакомые».
"""
import os, re, random, sys
E = os.environ.get
CHAR = E('CHAR', '1') == '1'
ACQ = E('ACQ', '1') == '1'
ACQ_P = float(E('ACQ_P', '0.5'))
APP = E('APP', '1') == '1'
ACQ_MODE = E('ACQ_MODE', 'smart')
ZN_T = int(E('ZN_T', '4'))

# ось: (первый полюс, второй полюс). Значение > 0 — к первому полюсу.
AXES = [('Самолюбие', 'Скромность'), ('Хватка', 'Щедрость'), ('Влюбчивость', 'Верность'),
        ('Соперничество', 'Участие'), ('Аппетит', 'Мера'), ('Вспыльчивость', 'Выдержка'), ('Беспечность', 'Усердие')]
DAT = {'Самолюбию': (0, 1), 'Скромности': (0, -1), 'Хватке': (1, 1), 'Щедрости': (1, -1), 'Влюбчивости': (2, 1), 'Верности': (2, -1),
       'Соперничеству': (3, 1), 'Участию': (3, -1), 'Аппетиту': (4, 1), 'Мере': (4, -1), 'Вспыльчивости': (5, 1), 'Выдержке': (5, -1),
       'Беспечности': (6, 1), 'Усердию': (6, -1)}
SHORT = {'Сл': 'Самолюбию', 'Ск': 'Скромности', 'Хв': 'Хватке', 'Щд': 'Щедрости', 'Вл': 'Влюбчивости', 'Вр': 'Верности', 'Сп': 'Соперничеству',
         'Уч': 'Участию', 'Ап': 'Аппетиту', 'Мр': 'Мере', 'Вс': 'Вспыльчивости', 'Вд': 'Выдержке', 'Бс': 'Беспечности', 'Ус': 'Усердию'}
# знак по тегу: (для первого полюса, для второго полюса) — из таблицы концепции
SIGN = [
    {'карьера': (1, -1), 'статус': (1, 0), 'помощь': (-1, 1), 'дружба': (-1, 1)},
    {'сделка': (1, 0), 'собственность': (1, 0), 'любовь': (-1, 0), 'дружба': (-1, 1), 'община': (0, 1)},
    {'любовь': (1, 0), 'здоровье': (-1, 0), 'конфликт': (-1, 1)},
    {'статус': (1, 0), 'карьера': (1, 0), 'дружба': (0, 1), 'община': (0, 1)},
    {'здоровье': (-1, 1), 'тело': (-1, 0), 'старение': (0, 1)},
    {'конфликт': (1, -1), 'закон': (-1, 1), 'насилие': (-1, 0), 'бюрократия': (0, 1)},
    {'работа': (-1, 1), 'образование': (-1, 1), 'карьера': (0, 1)},
]
TAG_RE = re.compile(r'#(\w+)')


def init(p):
    p.char = [0] * 7
    p.acq_used = set()
    if CHAR:
        a = random.randrange(7); p.char[a] = random.choice((1, -1))


def step(p, dat, toward_zero=False):
    if not CHAR or dat not in DAT: return
    a, sg = DAT[dat]
    if toward_zero:
        if p.char[a] > 0: p.char[a] -= 1
        elif p.char[a] < 0: p.char[a] += 1
        return
    p.char[a] = max(-2, min(2, p.char[a] + sg))


def mod(p, text):
    """Сумма поправок характера и «Знакомых» для карты с тегами из text."""
    if not text: return 0
    tags = set(TAG_RE.findall(text))
    if not tags: return 0
    m = 0
    if CHAR:
        for a, v in enumerate(p.char):
            if not v: continue
            for t in tags:
                if t in SIGN[a]:
                    m += abs(v) * SIGN[a][t][0 if v > 0 else 1]
    if ACQ:
        for k, n in p.items.items():
            if n > 0 and k.startswith('Знакомый:') and k.split(':', 1)[1] in tags: m += 1
    return m


def text_steps(p, t):
    if not CHAR or 'характер' not in t: return
    for m in re.finditer(r'характер на шаг к (\w+)', t):
        step(p, m.group(1))


def seg_enter(p, seg):
    if CHAR and APP and p.char[4] >= 1 and seg >= 1:   # Аппетит: заедает стресс, с Юности (16.11)
        p.phys -= 1
        if E('APP_PSY', '1') == '1': p.psy = min(10, p.psy + 1)


# ---------- знакомства ----------
_here = os.path.dirname(os.path.abspath(__file__))
for _d in (os.path.join(_here, '..', 'city'), '/home/claude/zhizn/city'):
    if os.path.exists(os.path.join(_d, 'decks.py')):
        sys.path.insert(0, _d); break
try:
    import decks as _DK
    BUILD = [(b[0], b[1], b[4]) for b in _DK.B]
except Exception:
    BUILD = []
RING = {'Окраина': 0, 'Середина': 1, 'Центр': 2}
# постоянные «Знакомые» — тег; остальные — разовая услуга (≈ +1 псих. сразу)
ZN_PERM = ['община', 'здоровье', 'собственность', 'работа', 'бюрократия', 'тело', 'медиа', 'вера', 'закон', 'связи', 'удовольствие',
           'сделка', 'культура', 'война', 'образование', 'насилие', 'девиация', 'статус', 'раскрытие']
ZN_ONCE = 17


def depth(w, p):
    if p.cls == 'Олигархи': return 2
    pos = w.countries[p.cidx]['pos']
    d = {'периферия': 0, 'полупериферия': 1}.get(pos, 2)
    if p.cls == 'Мафия': d = min(2, d + 1)
    return d


def links_cap(p):
    h = p.st['Харизма']
    return 2 if h <= 3 else 3 if h <= 6 else 4 if h <= 9 else 5


def want(w, p):
    if not ACQ or not BUILD or p.seg < 2: return False
    if ACQ_MODE == 'smart':   # знакомиться, когда здоровье в запасе или денег на обмен нет
        if p.phys >= 3 and p.psy >= 3: return random.random() < ACQ_P
        return p.vozm <= 1 and p.phys >= -2 and p.psy >= -2
    if p.phys < 0 or p.psy < 0: return False
    return random.random() < ACQ_P


def best_pole(p, a, b):
    """ИИ выбирает полюс: тот, что даёт больше к тегам своего смысла (или к работе/карьере), иначе случайно."""
    want_tags = set(p.card['tags']) if getattr(p, 'card', None) else set()
    want_tags |= {'работа', 'карьера'}
    def score(dat):
        ax, sg = DAT[dat]; v = max(-2, min(2, p.char[ax] + sg))
        s = 0
        for t in want_tags:
            if t in SIGN[ax]: s += abs(v) * SIGN[ax][t][0 if v > 0 else 1]
        return s + random.uniform(-0.3, 0.3)
    return a if score(a) >= score(b) else b


def acq(w, p):
    d = depth(w, p); seg = p.seg
    pool = [b for b in BUILD if RING[b[1]] <= d and (b[0], seg) not in p.acq_used]
    if not pool: return False
    name, ring, cards = random.choice(pool)
    p.acq_used.add((name, seg))
    c = random.choice(cards)
    step(p, best_pole(p, SHORT[c[2]], SHORT[c[3]]))
    w.stats['acq'] += 1; w.stats['acq_' + ring] += 1
    if c[4] and random.randint(1, 6) >= (ZN_T - 1 if ring == 'Центр' else ZN_T):
        w.stats['acq_zn'] += 1
        n_links = sum(v for k, v in p.items.items() if v > 0 and p.itype.get(k) in ('связь', 'знакомый'))
        k = random.randrange(len(ZN_PERM) + ZN_ONCE)
        if k >= len(ZN_PERM): p.psy = min(10, p.psy + 1); w.stats['acq_zn_once'] += 1
        elif n_links < links_cap(p):
            nm = 'Знакомый:' + ZN_PERM[k]
            if not p.items.get(nm): p.items[nm] = 1; p.itype[nm] = 'знакомый'; w.stats['acq_zn_perm'] += 1
    return True


def emigrate(p):
    for k in list(p.items):
        if k.startswith('Знакомый:'): p.items[k] = 0
