"""Монте-Карло «Жизни», версия 3 (ноябрь 2026): счастье, наследники, режим «Род».
Основа — sim2.py (механика рынка, событий, институтов, мира без изменений). Новое:
  * напечатанные развилки: «Образование» (последняя клетка Юности), «Эмиграция» (М, клетка 8, всегда «остаться»), «Партнёрство» (М, клетка 20);
  * колода смыслов (meanings.md): Династии при положении семьи +2, отказ от предназначения, кризис среднего возраста, Серость;
  * журнал жизни для условий смысла; брак, дети, метрика, наследство;
  * режим «Род» (MODE=rod): наследник-ребёнок по метрике или стандартный наследник, прерывание рода, Лестница поколений;
  * Итог мира и особые эпохи по настоящему счастью;
  * льготы Госсоциализма на образование (GS_EDU).
"""
import json, random, re, sys, os, collections as C
from engine3 import *
import engine3 as engine
import meanings as MN

E = os.environ.get
CARDS = json.load(open(E('CARDS', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cards_v4.json'))))   # v4: психика в Юности и Старости урезана (8-й прогон)
DREV_T = int(E('DREV_T', '12')); DREV_PER = int(E('DREV_PER', '-2'))
HOSP_T = int(E('HOSP_T', '0')); PSY_T = int(E('PSY_T', '0'))
OLDRULES = False
LAW_H = int(E('LAW_H', '1')); LAW_S = int(E('LAW_S', '0')); WORK2 = int(E('WORK2', '2'))
PODR_ALL = E('PODR_ALL', '1') == '1'; SMUTA_N = E('SMUTA_N', 'mil')
MODE = E('MODE', 'gen')                 # gen — «Поколение», rod — «Род»
AIMODE = E('AIMODE', 'aware')           # aware — игрок играет на свой смысл, naive — без учёта смысла
FORKS = E('FORKS', '1') == '1'          # напечатанные развилки как обязательные остановки
FORK_BURN = E('FORK_BURN', '0') == '1'
WORK3 = E('WORK3', '1') == '1'          # 6-й прогон: износ от работы по d6 (см. wear())
PERI_SHOP = int(E('PERI_SHOP', '0'))     # надбавка периферии к спортзалу, курсам, салону (до 6-го прогона 1)
PERI_HOSP = int(E('PERI_HOSP', '1'))
FLOOR8 = E('FLOOR8', '1') == '1'         # износ от работы по здоровью −8 и ниже уходит в другое здоровье
MEAN_SHARE = float(E('MEAN_SHARE', '0.6'))  # «Эпоха смыслов»: доля жизней со смыслом (до 7-го прогона 0.5)
SALON6 = E('SALON6', '1') == '1'
CARDPSY = E('CARDPSY', '0') == '1'      # диагностика: психика по картам и отрезкам         # салон: на d6 = 6 ещё +1 псих. (так в концепции)     # малый обмен больницы на периферии (до 6-го прогона 2)  # 1 — остаток хода на развилке сгорает (до 6-го прогона); 0 — после развилки фишка доходит оставшиеся клетки
EDU_IDEO = E('EDU_IDEO', '1') == '1'    # «+ к #образование» у госсоциализма и социал-демократии (+1 к вступительным)
EDU_GO = float(E('EDU_GO', '0.5'))      # ИИ идёт в вуз при шансе не ниже
EDU_DIFF = int(E('EDU_DIFF', '16'))     # сложность вступительных на «Образовании»
GS_EDU = E('GS_EDU', 'R')                # льготы госсоциализма: R — рабфак, S — стипендия, Z — заочное
HRAM_WED = E('HRAM_WED', '1') == '1'    # карта «Храм или бюро» = свадьба
PILOT = E('PILOT', '')
REFUSE = E('REFUSE', 'smart'); CRISIS = E('CRISIS', 'smart')
PART_REL_WED = E('PART_REL_WED', '1') == '1'   # «через родню»: d6 2–6 — сразу свадьба
CHILD_FORK = E('CHILD_FORK', '1') == '1'       # «Ребёнок» напечатан на поле (Зрелость, клетка 10), d6 2–6
TRAVEL_KID = E('TRAVEL_KID', '1') == '1'       # путешествие с парой: по желанию d6 5–6 — ребёнок
BROTHEL_KID = E('BROTHEL_KID', '1') == '1'     # бордель: d12 = 1 — «бастард»
GYM_CHEAP = E('GYM_CHEAP', '1') == '1'         # спортзал на 1 дешевле в военной диктатуре и госсоциализме
MKT_PRICE = int(E('MKT_PRICE', '2'))           # цена спортзала, курсов, салона (периферия +1)
ARMY_KEYS = E('ARMY_KEYS', '1') == '1'         # «Присяга» при входе в Молодость в Армии, «Офицерское звание» за выслугу
EMIG = E('EMIG', '1') == '1'                   # эмиграция
EMIG_ECON = float(E('EMIG_ECON', '1.0'))       # множитель «экономической» эмиграции без мотива смысла
EPOCH2 = E('EPOCH2', '1') == '1'               # эпоха чудес: 7+ на 10 мировых ходов; в «Роде» доли — по завершённым выращенным жизням
SWITCH_INT = int(E('SWITCH_INT', '6'))          # переход в Интеллигенцию после диплома — только при Интеллекте не ниже
V_CHILD_ROD = float(E('V_CHILD_ROD', '3.0')); V_SPOUSE_ROD = float(E('V_SPOUSE_ROD', '1.5'))

SEGS = ['Детство', 'Юность', 'Молодость', 'Зрелость', 'Старость', 'Древность']
SCODE = {'Д': 0, 'Ю': 1, 'М': 2, 'З': 3, 'С': 4, 'Др': 5}
CELLS = {0: [14, 4, 6, 2, 0, 1, 3], 1: [10, 6, 4, 4, 2, 1, 3], 2: [8, 6, 3, 6, 4, 1, 2], 3: [8, 5, 3, 7, 3, 1, 3], 4: [10, 5, 4, 5, 1, 1, 4], 5: [14, 4, 3, 2, 0, 1, 6]}
if FORKS: CELLS[1][4] -= 1; CELLS[2][4] -= 2
if E('CHILD_FORK', '1') == '1': CELLS[3][4] -= 1
CTYPES = ['Возраст', 'Отношения', 'Культура', 'Страна', 'Развилка', 'Судьба', 'Тихая']
IDEOS = ['Либеральная демократия', 'Социал-демократия', 'Теократия', 'Национализм', 'Госсоциализм', 'Военная диктатура', 'Клептократия']
FIN_DIST = {'ядро': [0.4, 2.4, 7.7, 40.7, 25.6, 17.4, 5.8], 'полупериферия': [1.9, 7.4, 16.7, 48.1, 16.7, 7.4, 1.9], 'периферия': [5.8, 17.4, 25.6, 40.7, 7.7, 2.4, 0.4]}
NARROW = [1.9, 7.4, 16.7, 48.1, 16.7, 7.4, 1.9]; WIDE = [4.6, 11.6, 21.3, 25, 21.3, 11.6, 4.6]
SCALE5 = {-3: -5, -2: -3, -1: -1, 0: 0, 1: 1, 2: 3, 3: 5}
CLASS_T = {-3: ['Народ'] * 6, -2: ['Народ'] * 5 + ['Армия'], -1: ['Народ'] * 4 + ['Армия', 'Полиция'], 0: ['Народ'] * 3 + ['Армия', 'Полиция', 'Интеллигенция'],
           1: ['Народ', 'Интеллигенция', 'Интеллигенция', 'Армия', 'Полиция', 'Мафия'], 2: ['Интеллигенция', 'Интеллигенция', 'Армия', 'Мафия', 'Олигархи', 'Олигархи'],
           3: ['Олигархи'] * 4 + ['Мафия', 'Мафия']}
INC = {'Народ': (1, 'Выносливость', 'Смекалка'), 'Армия': (2, 'Сила', 'Выносливость'), 'Полиция': (2, 'Сила', 'Смекалка'),
       'Интеллигенция': (2, 'Интеллект', 'Мудрость'), 'Мафия': (3, 'Смекалка', 'Ловкость'), 'Олигархи': (4, 'Харизма', 'Интеллект')}
RAISE = {'Народ': ('Выносливость', 'Смекалка'), 'Армия': ('Сила', 'Выносливость'), 'Полиция': ('Сила', 'Смекалка'), 'Олигархи': ('Харизма', 'Интеллект'),
         'Интеллигенция': ('Интеллект', 'Мудрость'), 'Мафия': ('Смекалка', 'Ловкость')}
WCOST = {'Народ': 'физ', 'Армия': 'физ', 'Интеллигенция': 'псих', 'Полиция': 'псих', 'Олигархи': 'псих', 'Мафия': 'риск'}
THAW = {'Ледоход', 'Паводок', 'Оттаявший могильник', 'Новая земля'}
RITES = {'Карвенцы': {'Мудрость': 1}, 'Олейцы': {'псих': 2}, 'Сарды': {'Выносливость': 1, 'псих': 1, 'физ': -1}, 'Веллийцы': {'физ': 2},
         'Тамирцы': {'псих': 2}, 'Хаддры': {'Смекалка': 1}, 'Эшвины': {'псих': 3}}
STIGMAS = {'Дурная слава', 'Судимость', 'Долг', 'Враг', 'Учёт', 'Без документов'}
CULTS = list(RITES)
_r = random.Random(777); DIST = {}
for _i, _a in enumerate(CULTS):
    for _b in CULTS[_i + 1:]:
        DIST[(_a, _b)] = DIST[(_b, _a)] = _r.choices([0, 1, 2, 3, 4, 5, 6, 8], weights=[4.8, 18.5, 30.7, 28.7, 12.5, 4.2, 0.5, 0.06])[0]
for _a in CULTS: DIST[(_a, _a)] = 0
EPRICE = {'периферия': 2, 'полупериферия': 4, 'ядро': 6}
PRANK = {'периферия': 0, 'полупериферия': 1, 'ядро': 2}
CLS_POP = {'Народ': 50, 'Армия': 12, 'Полиция': 10, 'Интеллигенция': 15, 'Мафия': 8, 'Олигархи': 5}

def world_index(name):
    if name.startswith('Спокойные'): return 1
    if name == 'Война': return -2
    if name in ('Чистка', 'Пандемия', 'Мировая война'): return -3
    return -1
def pick(dist): return random.choices(range(-3, 4), weights=dist)[0]
def wmod(W): return -1 if W <= 3 else 0 if W <= 6 else 1 if W <= 9 else 2
def segs_of(c):
    s = c.get('Отрезки', '') or c.get('Когда', '') or ''
    if not s or s == 'все': return set(range(6))
    out = set()
    for t in re.split(r'[\s,]+', s):
        if t in SCODE: out.add(SCODE[t])
    return out or set(range(6))
# вероятность 3d6 (с преимуществом — 4d6 без низшего) ≥ need
def _dist(adv):
    import itertools
    cnt = C.Counter()
    for r in itertools.product(range(1, 7), repeat=4 if adv else 3):
        cnt[sum(r) - (min(r) if adv else 0)] += 1
    n = sum(cnt.values()); return {k: v / n for k, v in cnt.items()}
D3, D4 = _dist(0), _dist(1)
def p_ge(need, adv=0):
    d = D4 if adv else D3; return sum(v for k, v in d.items() if k >= need)

DECK = C.defaultdict(list)
for c in CARDS:
    d = c['_deck']
    if d == 'Класс': DECK[('Класс', c['_sub'])].append(c)
    elif d == 'Развилка' and FORKS and 'на поле' in (c.get('Клетка', '') or ''): DECK['Развилка_поле'].append(c)
    elif d == 'Развилка' and E('CHILD_FORK', '1') == '1' and c.get('Развилка') == 'Ребёнок': DECK['Развилка_поле'].append(c); DECK['Развилка_ребёнок'].append(c)
    else: DECK[d].append(c)
EFFCOL = ['Эффект', 'Пути', 'Характеристика']
def card_effect(c):
    for k in EFFCOL:
        if c.get(k): return c[k]
    return c['_all']

# ---------- колода смыслов ----------
MCARDS = MN.parse(); GREY = [c for c in MCARDS if c['deck'] == 'grey'][0]
RANDOM = [c for c in MCARDS if c['deck'] == 'random']; DYN = [c for c in MCARDS if c['deck'] == 'dyn']
PIL = json.load(open(PILOT)) if PILOT and os.path.exists(PILOT) else None

# ---------- стандартные наследники (колода наследников) ----------
def _c(f): return f
STD = {
 'Народ': [dict(name='Двоюродный брат с хутора', seg=2, phys=1, psy=0, vozm=0, st=[5, 5, 3, 2, 2, 3, 4, 3], conds=['Возможности +5', 'Сила 6+', 'POS>', 'WED', 'Ребёнок', 'Дожить до Древности']),
           dict(name='Тётушка с почты', seg=3, phys=0, psy=0, vozm=1, st=[2, 3, 3, 4, 3, 4, 5, 2], conds=['LINKS3', 'Харизма 6+', 'Смекалка 6+', 'DON1', 'Ни разу не попасть в тюрьму', 'Дожить до Древности'])],
 'Армия': [dict(name='Отставной кузен-майор', seg=4, phys=-1, psy=0, vozm=2, st=[4, 4, 2, 3, 2, 4, 3, 3], conds=['POS1', 'Харизма 6+', 'Сила 5+', 'Оказаться на победившей стороне смены власти', 'Дожить до Древности', 'NOWARD']),
           dict(name='Крестник-кадет', seg=2, phys=1, psy=0, vozm=0, st=[5, 4, 4, 2, 1, 3, 2, 4], conds=['Побывать на войне', 'Сила 7+', 'Выносливость 6+', 'POS>', 'WED', 'Дожить до Старости'])],
 'Полиция': [dict(name='Дядя-инспектор в отставке', seg=4, phys=-1, psy=0, vozm=2, st=[3, 3, 2, 4, 3, 3, 5, 2], conds=['Смекалка 7+', 'LINKS2', 'Возможности +5', 'SIDE', 'Ни разу не попасть в тюрьму', 'Дожить до Древности']),
             dict(name='Племянник-констебль', seg=2, phys=0, psy=0, vozm=0, st=[4, 4, 3, 2, 2, 3, 3, 4], conds=['Смекалка 6+', 'Сила 5+', 'POS>', 'WED', 'Ребёнок', 'Ни разу не попасть в тюрьму'])],
 'Интеллигенция': [dict(name='Томная тётя', seg=3, phys=0, psy=-1, vozm=1, st=[1, 2, 2, 5, 3, 4, 2, 4], conds=['ARTNAME', 'Интеллект 7+', 'Харизма 6+', 'Возможности +5', 'Психическое здоровье +3', 'Дожить до Древности']),
                   dict(name='Троюродный поэт', seg=2, phys=0, psy=0, vozm=-1, st=[2, 2, 3, 4, 2, 4, 2, 5], conds=['ARTNAME', 'Красота 6+', 'Харизма 6+', 'Партнёр или Супруг(а)', 'Диплом', 'ZREL'])],
 'Мафия': [dict(name='Племянник с сомнительными знакомствами', seg=2, phys=0, psy=0, vozm=0, st=[4, 3, 5, 2, 1, 4, 4, 3], conds=['Возможности +10', 'DOLGOFF', 'LINKS3', 'Смекалка 6+', 'Ни разу не попасть в тюрьму', 'Дожить до Старости'], dolg=True),
           dict(name='Вдова двоюродного брата', seg=3, phys=0, psy=0, vozm=3, st=[2, 3, 3, 3, 4, 5, 4, 4], conds=['Семейная поддержка +1 и выше', 'POS>=', 'Харизма 7+', 'LINKS3', 'Ни разу не попасть в тюрьму', 'Дожить до Древности'])],
 'Олигархи': [dict(name='Племянник-повеса', seg=2, phys=0, psy=0, vozm=6, st=[3, 3, 3, 3, 1, 5, 2, 5], conds=['Возможности +15', 'Красота 6+', 'Харизма 7+', 'WED', 'Ни разу не попасть в кабалу', 'ZREL']),
              dict(name='Тётушка-благотворительница', seg=4, phys=-1, psy=0, vozm=8, st=[1, 2, 1, 4, 4, 5, 3, 3], conds=['DON3', 'Возможности +10', 'POS2', 'Харизма 6+', 'Ни разу не попасть в кабалу', 'Дожить до Древности'])]}
def links(p): return sum(v for k, v in p.items.items() if v > 0 and p.itype.get(k) == 'связь')
SPECIAL = {'POS>': lambda p: p.pos_ > p.pos_entry, 'POS>=': lambda p: p.pos_ >= p.pos_entry, 'POS1': lambda p: p.pos_ >= 1, 'POS2': lambda p: p.pos_ >= 2,
           'WED': lambda p: p.log['wed'] > 0, 'LINKS3': lambda p: links(p) >= 3, 'LINKS2': lambda p: links(p) >= 2, 'DON1': lambda p: p.donations >= 1,
           'DON3': lambda p: p.donations >= 3, 'NOWARD': lambda p: p.inst != 'Психбольница', 'SIDE': lambda p: p.log['smuta_side'] > 0,
           'ARTNAME': lambda p: p.log['name_art'] > 0 or p.items.get('Имя в искусстве', 0) > 0, 'ZREL': lambda p: p.maxseg >= 3, 'DOLGOFF': lambda p: p.log['dolg_off'] > 0}
for cl, lst in STD.items():
    for sc in lst:
        conds = []
        for t in sc['conds']:
            f = SPECIAL.get(t) or MN.build(t)[0]
            assert f is not None, t
            conds.append([1, t, '', f, 'ok'])
        sc['card'] = dict(id='Н:' + sc['name'], name=sc['name'], deck='std', kind='Наследник', req='', tags=[], conds=conds, cap=6, unreach_pts=0, reqf=lambda p: True)
        w = MN.wants(sc['card'])
        for t in sc['conds']:
            if t == 'WED': w['flags'].add('marry')
            if t in ('SIDE',) or 'победившей' in t: w['flags'].add('side')
            if t.startswith('DON'): w['flags'].add('donate')
            if t.startswith('LINKS'): w['flags'].add('friend')
            if t == 'DOLGOFF': w['flags'].add('dolgoff')
        sc['wants'] = w

class Player:
    def __init__(s, w, i, metr=None, std=None, gen=1, seat=None, born=0):
        s.i = i; s.w = w; s.gen = gen; s.seat = seat if seat is not None else i; s.born = born
        s.heir = 'first' if (metr is None and std is None) else ('child' if metr else 'std')
        s.items = C.Counter(); s.itype = {}; s.log = C.Counter(); s.segs = C.defaultdict(set); s.entry = {}
        s.alive = True; s.seg = 0; s.cell = 0; s.turns = 0; s.stazh = 0
        s.inst = None; s.inst_left = 0; s.death = None; s.done = False; s.closed = False
        s.used_seg = set(); s.meaning = None; s.grey = False; s.debts = 0; s.micro = 0
        s.lowpsy = 0; s.lowphys = 0; s.youth_used = 0
        s.skip = 0; s.kab_t = 0; s.stig_new = 0; s.don_since = 0; s.donations = 0
        s.n_psy = 0; s.n_hosp = 0; s.n_prison = 0; s.n_mk = 0; s.crossed = False
        s.dslava_ever = False; s.miracles = 0
        s.habit = False; s.vice = C.Counter(); s.pt = None; s.sp = None
        s.card = None; s.card_src = None; s.wants = None; s.locked = False; s.refusing = False; s.ref_try = 0; s.dyn = False
        s.crisis_done = False; s.swapped = False; s.happy = None; s.got = []; s.score_Z = None; s.card_Z = None
        s.kids_metr = []; s.parent_wmod = 0; s.inherit = None
        s.edu = None; s.student = False; s.uchil = False; s.edu_bonus = 0; s.prestige = False; s.edu_done = False; s.emig_done = False; s.part_done = False
        s.last_prison_seg = None; s.edu_ideo = None; s.zaoch_done = False; s.upb2 = False
        s.acc = 0; s.acc_fail = 0; s.acc_pen = 0; s.zem = None; s.nodoc_t = 0; s.stazh_here = 0; s.seg_abroad = 0; s.kid_done = False
        s.v_child = V_CHILD_ROD if MODE == 'rod' else engine.V_CHILD; s.v_spouse = V_SPOUSE_ROD if MODE == 'rod' else engine.V_SPOUSE
        if std is not None: s._init_std(*std); return
        if metr is not None:
            s.cidx = metr['cidx']; s.fin = metr['fin']; s.pos_ = metr['pos']; s.coh = metr['coh']; s.cls = metr['cls']
            s.culture = metr['culture']; s.race = metr['race']; s.minority = metr['minority']; s.inherit = metr.get('inherit')
            s.parent_wmod = wmod(metr['W'])
        else:
            s.cidx = random.choice(range(5)); pos = w.countries[s.cidx]['pos']
            s.fin = pick(FIN_DIST[pos]); s.pos_ = pick(NARROW); s.coh = pick(WIDE)
            s.cls = random.choice(CLASS_T[s.fin]); s.minority = random.random() < 0.2
            cc = w.countries[s.cidx].get('cult')
            s.culture = cc if (cc and not s.minority) else random.choice([x for x in CULTS if x != cc] or CULTS)
            s.race = random.choice(['лирен', 'тальв', 'сэйн', 'ванэ', 'кесс', 'орид', 'аэл'])
        s.phys = SCALE5[pick(WIDE)]; s.psy = SCALE5[s.coh]; s.vozm = SCALE5[s.fin] + SCALE5[s.pos_]
        s.st = {k: random.randint(1, 4) for k in ST}
        s.st['Смекалка'] = (s.st['Харизма'] + s.st['Мудрость'] + s.st['Интеллект']) // 3
        if metr is not None and metr['W'] >= 7: s.st['Мудрость'] += 1
        s.predisp = ['Сила', 'Выносливость', 'Ловкость', 'Харизма', 'Мудрость', 'Интеллект'][random.randint(0, 5)]
        s.female = random.random() < 0.5
        ax = list(range(11)); random.shuffle(ax); s.axes = [0] * 11
        for j, a in enumerate(ax[:6]): s.axes[a] = (2 if j < 3 else 1) * random.choice([-1, 1])
        s.cls0 = s.cls; s.fin0 = s.fin; s.pos0 = s.pos_; s.coh0 = s.coh; s.pos_entry = s.pos_
        s.ideo0 = w.countries[s.cidx]['ideo']; s.pos_c = w.countries[s.cidx]['pos']
        s.birth_c = s.cidx; s.citizen = set(metr['citizen']) if (metr is not None and metr.get('citizen')) else {s.cidx}; s.minority0 = s.minority
        s.min_v = s.vozm; s.max_v = s.vozm; s.min_phys = s.phys; s.min_psy = s.psy; s.maxseg = 0
        s.entry[0] = dict(phys=s.phys, psy=s.psy, vozm=s.vozm, cls=s.cls, spouse=False)
        s.init_meaning()

    def _init_std(s, sc, dead):
        s.cidx = dead.cidx; s.cls = dead.cls; s.fin = dead.fin; s.pos_ = dead.pos_; s.coh = max(-3, dead.coh - 1)
        s.culture = dead.culture; s.race = dead.race; s.minority = dead.minority
        s.seg = sc['seg']; s.cell = 0; s.maxseg = s.seg
        s.phys = sc['phys']; s.psy = sc['psy']; s.vozm = sc['vozm']
        s.st = dict(zip(['Сила', 'Выносливость', 'Ловкость', 'Интеллект', 'Мудрость', 'Харизма', 'Смекалка', 'Красота'], sc['st']))
        s.predisp = 'нет'; s.female = random.random() < 0.5; s.axes = list(dead.axes)
        if sc.get('dolg'): s.items['Долг'] = 1; s.itype['Долг'] = 'стигма'
        s.cls0 = s.cls; s.fin0 = s.fin; s.pos0 = s.pos_; s.coh0 = s.coh; s.pos_entry = s.pos_
        s.ideo0 = s.w.countries[s.cidx]['ideo']; s.pos_c = s.w.countries[s.cidx]['pos']
        s.birth_c = s.cidx; s.citizen = {s.cidx}; s.minority0 = s.minority
        s.edu_done = True
        s.inherit_now(dead)
        s.min_v = s.vozm; s.max_v = s.vozm; s.min_phys = s.phys; s.min_psy = s.psy
        s.entry[s.seg] = dict(phys=s.phys, psy=s.psy, vozm=s.vozm, cls=s.cls, spouse=False)
        s.card = sc['card']; s.card_src = 'std'; s.locked = True; s.crisis_done = True; s.meaning = s.seg
        s.wants = sc['wants'] if AIMODE == 'aware' else None

    def inherit_now(s, dead):
        s.vozm += dead.vozm; s.debts += dead.debts
        for k, v in dead.items.items():
            if v > 0 and dead.itype.get(k) == 'козырь': s.items[k] += v; s.itype[k] = 'козырь'; s.log['trump_got'] += 1
        s.clampv(); s.w.stats['inherit_' + s.heir] += 1; s.w.stats['inherit_vozm_' + s.heir] += dead.vozm

    # ---------- смысл ----------
    def set_card(s, c, src):
        s.card = c; s.card_src = src; s.wants = MN.wants(c) if AIMODE == 'aware' else None
        s.meaning = s.seg

    def draw_random(s, n=1):
        deck = RANDOM[:]; random.shuffle(deck); out = []
        for c in deck:
            if c['reqf'](s): out.append(c)
            if len(out) >= n: break
        return out

    def init_meaning(s):
        if s.pos_ >= 2:
            deck = DYN[:]; random.shuffle(deck)
            for c in deck:
                if c['reqf'](s): s.set_card(c, 'dyn'); s.dyn = True; break
            if s.card is not None:
                s.refusing = s.w.refuse_decision(s); return
        s.meaning_roll(16)

    def meaning_mod(s):
        return (0 if s.seg == 0 else wmod(s.st['Мудрость'])) + (1 if s.items.get('Наставник', 0) else 0)

    def meaning_roll(s, need):
        if s.card is not None: return
        if roll3(1 if s.predisp == 'Мудрость' and s.seg else 0) + s.meaning_mod() >= need:
            s.set_card(s.draw_random()[0], SEGS[s.seg])

    def refuse_roll(s, need):
        s.ref_try += 1
        if roll3(1 if s.predisp == 'Мудрость' else 0) + s.meaning_mod() >= need:
            opts = s.draw_random(3)
            best = max(opts, key=lambda c: s.w.card_value(c, s))
            s.w.stats['refuse_ok'] += 1; s.set_card(best, 'refuse'); s.locked = True; s.refusing = False; s.dyn = False
            return True
        return False

    def privilege_mod(s, t): return 0
    def cap(s, k): return 12 if s.items.get('чудо_' + k) else 10
    def vcap(s):
        if s.cls == 'Олигархи' and any(s.items.get(k, 0) > 0 for k in ('Партбилет', 'Человек из кабинета', 'Офшор')): return 20
        return 15
    def vfloor(s): return -15
    def clampv(s):
        cap = s.vcap()
        if s.vozm > cap: s.w.stats['burned'] += s.vozm - cap; s.vozm = cap
        s.vozm = max(s.vfloor(), s.vozm)

    def apply(s, d, seg, w):
        for k, v in d.items():
            if k == 'физ':
                if seg == 0 and v > 0: v += 1
                if seg == 2 and v < 0: v = min(0, v + 1)
                if seg == 4: v = v - 1 if v < 0 else max(0, v - 1)
                s.phys = min(10, s.phys + v); w.stats['flow_phys_' + SEGS[seg]] += v
            elif k == 'псих':
                if seg == 0 and v < 0: v -= 1
                if seg == 1: v = v + (1 if v > 0 else -1)
                s.psy = min(10, s.psy + v); w.stats['flow_psy_' + SEGS[seg]] += v
                if CARDPSY: w.stats['cpsy|' + SEGS[seg] + '|' + str(getattr(w, 'cur_card', '?'))] += v
            elif k == 'возм':
                s.vozm += v; s.clampv(); w.stats['flow_vozm_' + SEGS[seg]] += v
            elif k in ST:
                s.st[k] = max(0, min(s.cap(k), s.st[k] + v)); w.stats['stat_ev_' + k] += v
            elif k == 'Сплочённость': s.coh = max(-3, min(3, s.coh + v))
            elif k == 'Финансы семьи': s.fin = max(-3, min(3, s.fin + v))
            elif k == 'Положение семьи': s.pos_ = max(-3, min(3, s.pos_ + v))
        s.track(); s.check_death('event')

    def track(s):
        s.min_phys = min(s.min_phys, s.phys); s.min_psy = min(s.min_psy, s.psy)
        if s.phys < -5 or s.psy < -5 or s.vozm < -5: s.crossed = True

    # ---------- семья ----------
    def add_partner(s, via='event'):
        if s.items.get('Партнёр', 0) > 0 or s.items.get('Супруг', 0) > 0: s.items['Партнёр'] = min(1, s.items['Партнёр']); return
        s.items['Партнёр'] = 1; s.itype['Партнёр'] = 'связь'; s.log['partners'] += 1
        if via == 'relatives': s.pt = dict(cls=s.cls0, cult=True, race=True)
        else:
            cl = s.cls if random.random() < 0.6 else random.choices(list(CLS_POP), weights=list(CLS_POP.values()))[0]
            s.pt = dict(cls=cl, cult=random.random() < 0.8, race=random.random() < 0.85)
        if not s.pt['cult']: s.log['other_cult_partner'] += 1
        if not s.pt['race']: s.log['other_race_partner'] += 1

    def wed(s):
        if s.items.get('Партнёр', 0) <= 0 or s.items.get('Супруг', 0) > 0: return False
        s.items['Партнёр'] = 0; s.items['Супруг'] = 1; s.sp = s.pt or dict(cls=s.cls, cult=True, race=True)
        s.log['wed'] += 1
        if 'wed_seg' not in s.log or s.log['wed'] == 1: s.log['wed_seg'] = s.seg
        s.w.stats['wed_' + SEGS[s.seg]] += 1
        return True

    def lose_spouse(s, divorce):
        if s.items.get('Супруг', 0) <= 0: return
        s.items['Супруг'] = 0
        if divorce: s.log['divorce'] += 1
        else: s.log['widowed'] += 1

    @property
    def sp_cls(s): return s.sp['cls'] if s.sp else None
    @property
    def sp_same_cult(s): return s.sp['cult'] if s.sp else True
    @property
    def sp_same_race(s): return s.sp['race'] if s.sp else True

    def add_child(s, adopted=False):
        s.items['ребёнок'] += 1; s.kids_metr.append(s.metrika())
        if adopted: s.log['adopted'] += 1
        s.w.stats['child_' + SEGS[s.seg]] += 1

    def metrika(s):
        v = s.vozm
        fin = -3 if v <= -10 else -2 if v <= -5 else -1 if v <= -1 else 0 if v <= 4 else 1 if v <= 9 else 2 if v <= 14 else 3
        up = MN.CRANK[s.cls] > MN.CRANK[s.cls0] or any(k.startswith('Имя') and x > 0 for k, x in s.items.items())
        down = MN.CRANK[s.cls] < MN.CRANK[s.cls0] or s.items.get('Судимость', 0) > 0
        pos = max(-3, min(3, s.pos_ + (1 if up else 0) - (1 if down else 0)))
        sp = s.items.get('Супруг', 0) > 0; pt = s.items.get('Партнёр', 0) > 0
        coh = (1 if sp else 0) + (1 if s.psy >= 5 else 0) - (1 if s.psy <= -5 else 0) - (1 if s.habit else 0) - (0 if (sp or pt) else 1)
        return dict(cls=s.cls, fin=fin, pos=max(-3, min(3, pos)), coh=max(-3, min(3, coh)), W=s.st['Мудрость'], cidx=s.cidx, culture=s.culture,
                    race=s.race, minority=s.minority)

    def add_item(s, nm, typ, src=''):
        before = s.items.get(nm, 0)
        s.items[nm] += 1; s.itype[nm] = typ
        if typ == 'стигма': s.stig_new += 1; s.log['stigma_got'] += 1
        if typ == 'козырь': s.log['trump_got'] += 1
        if nm in ('Партбилет', 'Присяга', 'Значок'): s.log['party_items'] += 1
        if nm == 'Имя в искусстве': s.log['name_art'] += 1
        if nm == 'Дурная слава': s.dslava_ever = True

    def drop_item(s, nm):
        if s.items.get(nm, 0) > 0:
            if s.itype.get(nm) == 'стигма' or nm in STIGMAS:
                s.log['stigma_off'] += 1
                if nm == 'Долг': s.log['dolg_off'] += 1
            s.items[nm] = 0

    def side_effects(s, c, w):
        for m in re.finditer(r'(стигма|связь|статус|предмет|козырь)\s*«([^»]+)»', c):
            nm = m.group(2)
            if re.search(r'«%s»\s*(гаснет|теряется|снимается|сгорает)' % re.escape(nm), c): s.drop_item(nm); continue
            if nm == 'Партнёр': s.add_partner('event'); continue
            s.add_item(nm, m.group(1)); w.stats['item_' + m.group(1) + '_' + nm] += 1
        for m in re.finditer(r'«([^»]+)»\s*(гаснет|теряется|снимается)', c):
            s.drop_item(m.group(1))
        m = re.search(r'(?:класс|в класс|переход в класс|станешь|становишься)\s+(Народ\w*|Арми\w+|Полици\w+|Интеллигенци\w+|Мафи\w+|Олигарх\w+)(?!\s*[—:+−-])', c)
        if m and s.cls == 'Олигархи' and re.search(r'кроме (класса )?Олигарх', c + getattr(w, 'cur_full', '')): m = None
        if m and 'можно' not in c and 'разреш' not in c and 'остаётся' not in c:
            new = CLFORM.get(m.group(1), None)
            if new and new != s.cls: s.change_class(new, w)
        if 'разорён' in c.lower(): w.stats['razoren'] += 1
        if re.search(r'«Ребёнок»', c): s.add_child('воспитанник' in c)
        if 'переворачивается в Супруга' in c: s.wed()
        if re.search(r'«Партнёр»', c) and 'связь «Партнёр»' not in c and not re.search(r'нет Партн|без Партн|Партнёр\w*»?\s*(теряется|уходит)', c): s.add_partner('event')
        if re.search(r'[Пп]артн[её]р\w*\s*(теряется|уходит)', c): s.items['Партнёр'] = 0
        if re.search(r'Супруг\(а\) уходит', c): s.lose_spouse('Развод' in c or 'развод' in c)
        if re.search(r'\bтюрьм', c) and not re.search(r'не\s+тюрьм|без тюрьм|тюрьмы пусты|правило о тюрьме|в тюрьме', c) and s.inst is None:
            s.enter('Тюрьма', random.randint(1, 3) if 'лёгк' in c else random.randint(1, 3) + (0 if random.random() < 0.6 else 3))
        if re.search(r'эмигр|уезжаешь|уехать', c): w.stats['emig_mention'] += 1
        if 'на «Образовании» +1' in c or '+1 к проверкам #образование' in c: s.edu_bonus += 1
        if '✨' in c: s.miracles += 1

    def change_class(s, new, w):
        old = s.cls
        if new in ('Армия', 'Полиция') and s.cidx not in s.citizen: w.stats['class_blocked_citizen'] += 1; return
        if old == 'Армия' and s.items.get('Присяга', 0): s.items['Присяга'] = 0
        if old == 'Полиция' and s.items.get('Значок', 0): s.items['Значок'] = 0
        w.stats['class_change'] += 1; w.trans[(old, new)] += 1; s.log['cls_change'] += 1
        if old == 'Мафия': s.log['left_mafia'] += 1
        if old == 'Армия': s.log['left_army'] += 1
        if old == 'Олигархи': s.log['left_olig'] += 1; w.stats['olig_fall|' + str(getattr(w, 'cur_card', '?'))] += 1
        s.cls = new; s.clampv()

    def enter(s, inst, turns):
        if s.log['out_ever'] > 0: s.log['reentered'] += 1
        s.inst = inst; s.inst_left = turns; s.w.stats['inst_' + inst] += 1
        if inst == 'Тюрьма':
            s.n_prison += 1; c = s.w.country(s); s.w.stats['prison_pos_' + c['pos']] += 1; s.w.stats['prison_ideo_' + c['ideo']] += 1
        if inst == 'Психбольница': s.log['ward'] += 1
        if inst == 'Кабала': s.log['kabala'] += 1

    def leave(s):
        if s.inst == 'Тюрьма':
            s.add_item('Судимость', 'стигма'); s.log['prison_out'] += 1; s.last_prison_seg = s.seg
            if s.cls == 'Олигархи': s.log['olig_sud'] += 1
        if s.inst == 'Психбольница' and s.seg >= 2: s.add_item('Учёт', 'стигма'); s.last_prison_seg = s.seg
        s.log['out_ever'] += 1; s.log['stazh_at_out'] = s.stazh
        s.inst = None

    def check_death(s, cause):
        if not s.alive: return
        if s.phys <= -10:
            if s.inst == 'Кабала': s.phys = -9; return
            s.die('физ (' + cause + ')'); return
        if s.psy <= -10:
            if s.seg == 0:
                s.psy = -9; s.skip = max(s.skip, 1); s.w.stats['child_floor'] += 1; return
            if s.seg == 1:
                if not getattr(s, 'teen_sryv', False) and s.inst != 'Психбольница':
                    s.teen_sryv = True; s.psy = -9; s.skip = max(s.skip, 1); s.w.stats['teen_sryv'] += 1; return
                s.psy = -8; s.w.stats['teen_ward'] += 1
                if s.inst != 'Психбольница': s.enter('Психбольница', 6)
                return
            if s.inst == 'Кабала': s.psy = -9; return
            pos = s.w.country(s)['pos']; lim = {'ядро': 4, 'полупериферия': 3, 'периферия': 1}[pos]
            if s.w.country(s)['ideo'] == 'Социал-демократия': lim += 1
            if d6() <= lim:
                s.psy = -8; s.enter('Психбольница', 6); s.w.stats['psych_saved'] += 1
            else: s.die('психика (' + cause + ')')

    def die(s, why):
        s.alive = False; s.death = (SEGS[s.seg], why); s.w.stats['death_' + why.split(' ')[0]] += 1


class World:
    def __init__(s, rounds):
        s.stats = C.Counter(); s.trans = C.Counter(); s.gstat = C.Counter(); s.wt = 0; s.round = 0; s.rounds = rounds
        poss = ['ядро', 'полупериферия', 'полупериферия', 'периферия', 'периферия']; random.shuffle(poss)
        s.countries = []
        for pos in poss:
            ideo = random.choice(IDEOS); dom = random.choice(CLASSES); ali = random.choice([c for c in CLASSES if c != dom])
            conflict = random.random() < 0.3
            stab = 5 + (1 if pos == 'ядро' else -1 if pos == 'периферия' else 0) - (2 if conflict else 0) - (2 if ali == 'Народ' else 0)
            s.countries.append(dict(pos=pos, ideo=ideo, dom=dom, ali=ali, stab=stab, conflict=conflict, crises=0, changes=0, war=False,
                                    cult=random.choice(CULTS), purge=False))
        s.rel = {}
        for i in range(5):
            for j in range(i + 1, 5):
                r = d6(); s.rel[(i, j)] = 'вражда' if r <= 2 else 'нейтралитет' if r <= 4 else 'союз'
        s.diaspora = {(ci, cu): (s.countries[ci]['cult'] == cu or random.random() < 0.4) for ci in range(5) for cu in CULTS}
        s.card_count = C.Counter(); s.card_psy = C.Counter(); s.card_phy = C.Counter()
        s.players = [Player(s, i) for i in range(4)]
        s.lives = []; s.cut = [False] * 4; s.std_used = [set() for _ in range(4)]

    def country(s, p): return s.countries[p.cidx]

    # ---------- решения ИИ о смысле ----------
    def card_value(s, c, p):
        """Ожидаемая ценность карты для игрока: пилотное среднее + то, что уже выполнено."""
        base = PIL['mean'].get(c['id'], 4.0) if PIL else 4.0
        return base + 0.5 * MN.score(c, p)

    def refuse_decision(s, p):
        if REFUSE != 'smart' or not PIL: return False
        dv = PIL['mean'].get(p.card['id'], 4.0); rv = PIL.get('best3', 5.0)
        return dv < rv - 1.0

    def crisis(s, p):
        """Кризис среднего возраста: первый вход в Зрелость, смысл найден раньше (случайная карта)."""
        p.crisis_done = True
        if CRISIS != 'smart' or p.locked or p.dyn or p.card is None or p.card['deck'] != 'random': return
        cur = MN.score(p.card, p)
        fut = (lambda c: (PIL['mean'].get(c['id'], 4) - PIL['atZ'].get(c['id'], 2)) if PIL else 0)
        sample = [x for x in random.sample(RANDOM, 25) if x['reqf'](p)]
        ev_swap = sum(MN.score(x, p) + fut(x) for x in sample) / max(1, len(sample))
        if ev_swap > cur + fut(p.card) + 0.5:
            s.stats['crisis_swap'] += 1; p.swapped = True
            p.set_card(p.draw_random()[0], 'crisis')

    def on_choice(s, p, text):
        t = text.strip().lower()
        if t.startswith('спрятать'): p.log['hide_neighbor'] += 1
        if t.startswith('сказать') and '#раскрытие' in (getattr(s, 'cur_full', '') or ''): p.log['say_reveal'] += 1
        if t.startswith('развестись'): p.lose_spouse(True)
        if t.startswith('учить молодых'): p.log['pupil'] += 1

    def income(s, p, cls=None):
        cls = cls or p.cls
        b, a1, a2 = INC[cls]; c = s.country(p)
        apt = (p.st[a1] + p.st[a2]) // 2; apt = 0 if apt <= 3 else 1 if apt <= 6 else 2 if apt <= 9 else 3
        d = b + apt + (1 if p.pos_ >= 2 else 0) + (1 if c['dom'] == cls else -1 if c['ali'] == cls else 0)
        d += {'ядро': 1, 'полупериферия': 0, 'периферия': -1}[c['pos']]
        if c['ideo'] == 'Госсоциализм': d = 2 + apt
        if c['ideo'] == 'Социал-демократия': d = max(2, d - 1)
        if c['ideo'] == 'Военная диктатура' and cls in ('Армия', 'Полиция'): d += 2
        if c['ideo'] == 'Клептократия' and cls in ('Мафия', 'Олигархи'): d += 2
        if c['ideo'] == 'Национализм': d += -1 if p.minority else 1
        if p.uchil and p.seg == 2: d += 1
        return max(1, d)

    def only_ok(s, c, p):
        t = (c.get('Текст', '') or '')
        m = re.match(r'Только ([^.]*)\.', t)
        if not m: return True
        q = m.group(1).lower(); cc = s.country(p); it = p.items
        partner = it.get('Партнёр', 0) + it.get('Супруг', 0) > 0
        res = True
        mcl = re.search(r'для классов ([^.]*?)(?: и при|$)', q)
        if mcl: res = res and any(p.cls.lower() == x.strip() for x in re.split(r',\s*|\s+и\s+', mcl.group(1)))
        for k, v in CLFORM.items():
            if 'для класса ' + k.lower() in q: res = res and p.cls == v
            if 'не из класса ' + k.lower() in q: res = res and p.cls != v
        for nm in re.findall(r'«([^»]+)»', m.group(1)): res = res and it.get(nm, 0) > 0
        if 'без партн' in q: res = res and not partner
        elif 'без супруг' in q: res = res and it.get('Супруг', 0) == 0
        elif 'при супруг' in q or 'есть брак' in q: res = res and it.get('Супруг', 0) > 0
        elif 'партн' in q: res = res and partner
        elif 'супруг' in q: res = res and it.get('Супруг', 0) > 0
        if 'ребён' in q or 'есть дети' in q or 'двух детях' in q: res = res and it.get('ребёнок', 0) > 0
        if 'сплочённости −1 и ниже' in q: res = res and p.coh <= -1
        ideo = cc['ideo']
        if 'государственном социализме' in q or 'госсоциализм' in q:
            res = res and (ideo == 'Госсоциализм' or ('военной диктатур' in q and ideo == 'Военная диктатура') or ('социал-демократ' in q and ideo == 'Социал-демократия') or ('национализм' in q and ideo == 'Национализм'))
        elif 'теократи' in q: res = res and ideo == 'Теократия'
        elif 'национализм' in q: res = res and ideo == 'Национализм'
        elif 'в диктатурах' in q: res = res and (ideo in ('Военная диктатура', 'Госсоциализм', 'Теократия') or ('клептократ' in q and ideo == 'Клептократия'))
        if 'периферии' in q and 'ядр' not in q: res = res and cc['pos'] != 'ядро'
        if 'доминирующего класса' in q: res = res and cc['dom'] == p.cls
        if 'отчужд' in q:
            for k, v in CLFORM.items():
                if q.startswith('если ' + k.lower()): res = res and cc['ali'] == v
        mm = re.search(r'стабильности (\d+) и выше', q)
        if mm: res = res and cc['stab'] >= int(mm.group(1))
        if 'менялась власть' in q: res = res and cc['changes'] > 0
        if 'чужак' in q: res = res and p.minority
        if 'не в родной стране' in q: res = res and p.cidx != p.birth_c
        return res

    def draw(s, deck, p, seg):
        pool = DECK[deck]
        if deck in ('Отношения', 'Страна', 'Культура', 'Судьба', 'Развилка', 'Развилка_ребёнок') or isinstance(deck, tuple):
            pool = [c for c in pool if seg in segs_of(c)] or pool
        for _ in range(12):
            c = random.choice(pool)
            if s.only_ok(c, p): break
            s.stats['only_skip'] += 1
        s.stats['draw_' + (deck if isinstance(deck, str) else 'Класс')] += 1
        nm = c.get('Карта', c.get('Развилка', '?'))
        s.card_count[(deck, nm)] += 1; s.cur_card = str(deck) + ' | ' + str(nm); s.cur_full = ' '.join(str(v) for v in c.values())
        ps0, ph0 = p.psy, p.phys
        s.last_fail = False
        if nm == 'Вернуться домой':   # развилка: вернуться без проверки границы или остаться
            fl = p.wants['flags'] if p.wants else set()
            if ('emig' in fl and 'return' not in fl) or not EMIG: p.vozm += 1; p.psy -= 1; s.stats['home_card_stay'] += 1
            else: s.arrive(p, p.birth_c, True, 'return', 'карта'); p.psy = min(10, p.psy + 2); s.stats['home_card_back'] += 1
            return c
        had_sp = p.items.get('Супруг', 0) > 0; wid0 = p.log['widowed']; div0 = p.log['divorce']
        exec_text(card_effect(c), p, s, seg)
        if nm == 'Развод' and had_sp:
            if p.log['widowed'] > wid0: p.log['widowed'] -= 1
            p.items['Супруг'] = 0
            if p.log['divorce'] == div0: p.log['divorce'] += 1
        if HRAM_WED and nm == 'Храм или бюро' and p.alive and p.wed(): s.stats['wed_hram'] += 1
        if EMIG and '#закон' in (c.get('Теги', '') or '') and p.items.get('Без документов', 0) and p.alive and p.inst is None and d6() <= 2:
            hostile = s.relation(p.birth_c, p.cidx) == 'вражда'
            p.drop_item('Без документов'); s.stats['deported'] += 1; s.arrive(p, p.birth_c, True, 'deport', 'депортация')
            if hostile: p.enter('Тюрьма', random.randint(1, 3))
        if s.last_fail and '#закон' in (c.get('Теги', '') or '') and p.inst is None and p.alive and seg >= 1:
            cc = s.country(p); harsh = cc['pos'] == 'периферия' or cc['ideo'] in ('Военная диктатура', 'Госсоциализм', 'Теократия', 'Национализм')
            if d6() <= (LAW_H if harsh else LAW_S): p.enter('Тюрьма', random.randint(1, 3)); s.stats['prison_law'] += 1
        key = (deck if isinstance(deck, str) else 'Класс:' + deck[1]) + ' | ' + str(nm)
        s.card_psy[key] += p.psy - ps0; s.card_phy[key] += p.phys - ph0
        if '✨' in str(nm): p.miracles += 1
        return c

    # ---------- эмиграция ----------
    def relation(s, a, b): return 'свои' if a == b else s.rel[(min(a, b), max(a, b))]

    def legal_exit(s, p): return s.countries[p.cidx]['ideo'] not in ('Госсоциализм', 'Военная диктатура')

    def pick_dest(s, p, kind):
        opts = [ci for ci in range(5) if ci != p.cidx]
        if kind == 'vol': opts = [ci for ci in opts if s.relation(p.cidx, ci) != 'вражда']
        if not opts: return None
        def score(ci):
            c = s.countries[ci]
            return (PRANK[c['pos']], s.relation(p.cidx, ci) == 'союз', p.culture == c['cult'], ci in p.citizen, random.random())
        return max(opts, key=score)

    def emigrate(s, p, kind, dest=None, invite=False, motive=''):
        """kind: vol — по своей воле, flight — бегство, illegal — нелегально. Возвращает True, если переехал."""
        if not EMIG or not p.alive or p.inst or p.heir == 'std': return False
        if dest is None: dest = s.pick_dest(p, kind)
        if dest is None or dest == p.cidx: return False
        home = p.cidx; rel = s.relation(home, dest); c = s.countries[dest]
        price = max(0, EPRICE[c['pos']] - (1 if invite else 0))
        if kind == 'vol' and (rel == 'вражда' or not s.legal_exit(p)) and dest not in p.citizen: kind = 'illegal'
        if kind in ('vol', 'illegal'):
            if p.vozm < price: return False
            p.vozm -= price
        s.stats['emig_try_' + kind] += 1
        legal = kind != 'illegal'
        if kind == 'flight':
            if roll3(1 if p.predisp == 'Ловкость' else 0) + p.st['Ловкость'] < 15:
                p.phys -= 3; p.vozm = p.vozm // 2 if p.vozm > 0 else p.vozm; s.stats['flight_hurt'] += 1
        elif kind == 'vol' and dest not in p.citizen:
            mod = (2 if rel == 'союз' else 0) + (1 if invite else 0) + (1 if p.items.get('Диплом', 0) else 0) + (1 if p.vozm >= 10 else 0) \
                  + (1 if p.zem == dest else 0) - (2 if p.items.get('Судимость', 0) else 0)
            mod = max(-3, min(3, mod))
            if roll3() + mod < 12:
                s.stats['emig_border_fail'] += 1
                wn = p.wants
                if wn and ('emig' in wn['flags'] or 'illegal' in wn['flags']): legal = False
                else: return False
        s.arrive(p, dest, legal, kind, motive)
        return True

    def arrive(s, p, dest, legal, kind, motive):
        home = p.cidx; rel = s.relation(home, dest); c = s.countries[dest]
        back = dest == p.birth_c
        keep_cls = p.cls == 'Олигархи' or p.vozm >= 15
        p.cidx = dest; s.stats['emig_' + kind] += 1; s.stats['emig_motive_' + motive] += 1
        if back:
            p.log['returned'] += 1; p.minority = p.minority0; p.acc = 0; p.acc_pen = 0
        else:
            p.log['emig'] += 1
            if kind == 'flight': p.log['flight'] += 1
            pen = 0 if p.culture == c['cult'] else DIST[(p.culture, c['cult'])]
            p.psy -= pen; p.acc = 0; p.acc_fail = 0; p.acc_pen = pen; p.minority = p.culture != c['cult']
        p.log['moves'] += 1; p.stazh_here = 0
        # класс: на новом месте — Народ, кроме исключений; дома класс остаётся тем, каким стал
        if not back and not keep_cls:
            if p.cls == 'Мафия': p.pos_ = max(-3, p.pos_ - 1)
            elif p.cls == 'Интеллигенция' and p.items.get('Диплом', 0) and roll3() + p.st['Интеллект'] >= 15: pass
            elif p.cls != 'Народ': p.change_class('Народ', s)
        for k in ('Присяга', 'Значок'):
            if p.items.get(k, 0): p.items[k] = 0
        for k in [x for x, v in p.items.items() if v > 0 and (x.startswith('Друг') or x in ('Наставник', 'Покровитель'))]:
            for _ in range(p.items[k]):
                if d6() <= 3: p.items[k] -= 1
        if rel != 'союз':
            for k in ('Судимость', 'Учёт'):
                if p.items.get(k, 0): p.items[k] = 0
        if rel == 'вражда' and p.items.get('Долг', 0): p.items['Долг'] = 0
        if not legal and dest not in p.citizen:
            p.add_item('Без документов', 'стигма'); p.nodoc_t = 0; s.stats['emig_illegal_entry'] += 1

    def emig_fork(s, p):
        """Развилка «Эмиграция» (Молодость, клетка 8): А) уехать по приглашению, Б) остаться, В) отправить родственника."""
        p.emig_done = True; s.stats['fork_emig'] += 1
        wn = p.wants; fl = wn['flags'] if wn else set(); home = s.countries[p.cidx]
        if 'stay' not in fl and EMIG:
            go = 'emig' in fl
            if not go:
                better = [ci for ci in range(5) if ci != p.cidx and PRANK[s.countries[ci]['pos']] > PRANK[home['pos']] and s.relation(p.cidx, ci) != 'вражда']
                base = {'периферия': 0.15, 'полупериферия': 0.05, 'ядро': 0.0}[home['pos']] * EMIG_ECON
                if better and s.legal_exit(p) and random.random() < base: go = True; motive = 'econ'
            else: motive = 'смысл'
            if go and s.emigrate(p, 'vol', invite=True, motive=motive): s.stats['fork_emig_A'] += 1; return
        vC = value({'возм': -2, 'Сплочённость': 1, '_good': 1}, p)
        if p.vozm >= 2 and vC > 0.5 + random.uniform(-0.5, 0.5):
            p.vozm -= 2; p.coh = min(3, p.coh + 1); p.add_item('Земляк', 'связь')
            p.zem = s.pick_dest(p, 'vol'); s.stats['fork_emig_C'] += 1
        else: s.stats['fork_emig_B'] += 1

    def emig_seg(s, p, seg):
        """При входе в отрезок: аккультурация, натурализация, «Без документов», решения о переезде."""
        if not EMIG: return
        abroad = p.cidx != p.birth_c
        if p.items.get('Без документов', 0) > 0: p.log['seg_nodocs'] += 1
        if abroad:
            p.seg_abroad += 1
            if p.acc < 3:
                im = -1 if p.st['Интеллект'] <= 3 else 0 if p.st['Интеллект'] <= 6 else 1 if p.st['Интеллект'] <= 9 else 2
                if roll3(1 if seg < 3 else 0) + im >= 8 + p.acc_pen:
                    p.acc += 1; p.psy += -(-p.acc_pen // 3); p.acc_fail = 0
                    if p.acc >= 3: p.minority = False; s.stats['acc3'] += 1
                else:
                    p.acc_fail += 1
                    if p.acc_fail >= 2: p.psy -= 1; p.acc_fail = 0; s.stats['acc_marginal'] += 1
                p.log['acc_max'] = max(p.log['acc_max'], p.acc)
            if p.cidx not in p.citizen and p.acc >= 2 and p.stazh_here >= 5 and not p.items.get('Без документов', 0):
                if s.relation(p.birth_c, p.cidx) == 'союз' or roll3() + p.st['Смекалка'] + (2 if p.items.get('Супруг', 0) else 0) >= 12:
                    p.citizen.add(p.cidx); s.stats['naturalized'] += 1
        wn = p.wants; fl = wn['flags'] if wn else set()
        if seg >= 2 and p.emig_done and not p.inst:
            if 'return' in fl and abroad and p.seg_abroad >= 1 and p.log['returned'] == 0:
                s.emigrate(p, 'vol', dest=p.birth_c, motive='возврат')
            elif 'emig' in fl and p.log['emig'] == 0:
                s.emigrate(p, 'vol', motive='смысл')
            elif 'twice' in fl and p.log['emig'] == 1 and p.seg_abroad >= 1:
                s.emigrate(p, 'vol', motive='смысл')

    def flight_chance(s, ci, why):
        """Мировой ход дал право бегства жителям страны ci (война, чистка, смена власти)."""
        if not EMIG: return
        for p in s.players:
            if not p or not p.alive or p.done or p.inst or p.cidx != ci or p.seg < 2: continue
            wn = p.wants; fl = wn['flags'] if wn else set()
            if 'stay' in fl: continue
            want = ('flight' in fl or 'emig' in fl) and p.log['emig'] == 0
            if not want:
                base = {'war': 0.03, 'purge': 0.08 if p.minority else 0.02, 'power': 0.0}[why] * EMIG_ECON
                if why == 'power' and getattr(p, 'smuta_lost', False) and s.countries[ci]['ideo'] in ('Военная диктатура', 'Госсоциализм', 'Теократия', 'Национализм'):
                    base = 0.3 * EMIG_ECON
                want = random.random() < base
            if want: s.emigrate(p, 'flight', motive='бегство:' + why)

    # ---------- напечатанные развилки ----------
    def education(s, p):
        c = s.country(p); I = p.st['Интеллект']; s.cur_full = '#образование'
        p.edu_ideo = c['ideo']
        fmod = 2 if p.fin >= 1 else -2 if p.fin <= -2 else 0
        gs = c['ideo'] == 'Госсоциализм'
        if gs and 'R' in GS_EDU and fmod < 0: fmod = 0        # рабфак: бедность семьи не мешает поступлению
        if gs and 'Q' in GS_EDU and p.cls0 == 'Народ': fmod += 1   # квота для детей рабочих и крестьян
        mod = fmod + (2 if p.items.get('Наставник', 0) else 0) + min(2, p.edu_bonus)
        if EDU_IDEO and c['ideo'] in ('Госсоциализм', 'Социал-демократия'): mod += 1
        mod = max(-3, min(3, mod)); adv = 1 if p.predisp == 'Интеллект' else 0
        ps = p_ge(EDU_DIFF - I - mod, adv); wn = p.wants
        want = bool(wn and ('Диплом' in wn['items'] or 'Интеллигенция' in wn['cls'] or wn['stats'].get('Интеллект', 0) >= 7))
        thr = EDU_GO - (0.15 if gs and 'S' in GS_EDU else 0)
        if want: go = ps >= 0.25
        elif p.cls in ('Мафия', 'Олигархи'): go = ps >= 0.7 and random.random() < 0.5
        else: go = ps >= thr
        s.stats['edu_n'] += 1; s.stats['edu_ps_sum'] += ps
        if go:
            s.stats['edu_try'] += 1; r = roll3(adv) + I + mod
            if r >= EDU_DIFF:
                p.student = True; p.edu = 'A'; s.stats['edu_A'] += 1
                if r >= EDU_DIFF + 5: p.prestige = True; p.log['prestige'] += 1
                return
            p.psy -= 1; s.stats['edu_fail'] += 1
        # Б (училище) доминирует В (сразу работа): +1 к пригодности и доход +1 всю Молодость
        a1, a2 = INC[p.cls][1:]; k = a1 if p.st[a1] <= p.st[a2] else a2
        p.st[k] = min(p.cap(k), p.st[k] + 1); p.uchil = True; p.edu = 'B'; s.stats['edu_B'] += 1

    def graduate(s, p):
        p.student = False; p.add_item('Диплом', 'статус'); s.stats['diploma_A'] += 1
        p.st['Интеллект'] = min(p.cap('Интеллект'), p.st['Интеллект'] + 1)
        wn = p.wants
        if p.cls not in ('Интеллигенция', 'Олигархи', 'Мафия') and p.st['Интеллект'] >= SWITCH_INT:
            want_i = wn and 'Интеллигенция' in wn['cls']; keep = wn and p.cls in wn['cls'] and not want_i
            if not keep and (want_i or s.income(p, 'Интеллигенция') > s.income(p) or (p.cls == 'Народ' and s.income(p, 'Интеллигенция') >= s.income(p))):
                p.change_class('Интеллигенция', s); s.stats['diploma_to_intel'] += 1

    def zaochnoe(s, p):
        """Госсоциализм, льгота Z: заочное/вечернее высшее — одна попытка при входе в Зрелость без Диплома."""
        p.zaoch_done = True
        c = s.country(p)
        if c['ideo'] != 'Госсоциализм' or p.items.get('Диплом', 0) > 0: return
        I = p.st['Интеллект']; mod = 1 if EDU_IDEO else 0; adv = 1 if p.predisp == 'Интеллект' else 0
        ps = p_ge(EDU_DIFF - I - mod, adv); wn = p.wants
        want = bool(wn and ('Диплом' in wn['items'] or 'Интеллигенция' in wn['cls']))
        if not (want or ps >= 0.5) or p.phys <= -5 or p.psy <= -5: return
        s.stats['zaoch_try'] += 1; p.phys -= 1
        if roll3(adv) + I + mod >= EDU_DIFF:
            p.add_item('Диплом', 'статус'); s.stats['zaoch_ok'] += 1; s.stats['diploma_Z'] += 1
        else: p.psy -= 1

    def child_fork(s, p):
        """Развилка «Ребёнок» на поле (Зрелость, клетка 10): А) решиться — d6 2–6 ребёнок, 1 — не получилось; Б) подождать; В) без детей."""
        s.stats['fork_child_pair'] += 1
        a = value({'возм': -2, 'псих': 2, '_child': 1}, p) * 5 / 6 - 1 / 6
        b = value({'возм': 1}, p); c = value({'возм': 1}, p) - (2 / 3 if p.items.get('Супруг', 0) else 0)
        ch = max((('A', a), ('B', b), ('C', c)), key=lambda x: x[1] + random.uniform(-0.3, 0.3))[0]
        s.stats['fork_child_' + ch] += 1
        if ch == 'A':
            if d6() >= 2:
                p.vozm -= 2; p.psy = min(10, p.psy + 2); p.add_child()
                if roll3(1 if p.predisp == 'Выносливость' else 0) + p.st['Выносливость'] < 12: p.phys -= 2
            else: p.psy -= 1; s.stats['fork_child_fail'] += 1
        elif ch == 'B': p.vozm += 1
        else:
            p.vozm += 1
            if p.items.get('Супруг', 0) and d6() <= 2: p.coh = max(-3, p.coh - 1)

    def partnership(s, p):
        p.part_done = True; s.cur_full = '#любовь #семья'
        if p.items.get('Супруг', 0) > 0: s.stats['part_married'] += 1; return
        if p.items.get('Партнёр', 0) > 0:
            opts = {'A': value({'возм': -2, 'псих': 2, '_spouse': 1}, p), 'B': value({'псих': 1}, p), 'C': value({'псих': -2}, p)}
            ch = max(opts, key=lambda k: opts[k] + random.uniform(-0.5, 0.5)); s.stats['part_has_' + ch] += 1
            if ch == 'A': p.vozm -= 2; p.psy = min(10, p.psy + 2); p.wed(); s.stats['wed_fork'] += 1
            elif ch == 'B': p.psy = min(10, p.psy + 1)
            else: p.items['Партнёр'] = 0; p.psy -= 2
            return
        # нет партнёра: Б (через родню) почти всегда лучше; А — если смысл хочет другой культуры
        wn = p.wants
        if wn and any('другой культуры' in t or 'другой расы' in t for _, t, *_ in p.card['conds']):
            s.stats['part_none_A'] += 1
            if roll3() + p.st['Красота'] + (1 if p.st['Харизма'] >= 6 else 0) >= 12: p.add_partner('event')
            else: p.psy -= 1
            return
        s.stats['part_none_B'] += 1; p.add_partner('relatives'); p.coh = min(3, p.coh + 1)
        if PART_REL_WED and d6() >= 2 and p.wed(): s.stats['wed_rel'] += 1

    # ---------- рынок (как в sim2, плюс журнал и игра на смысл) ----------
    def hosp_price(s, p, c, big=False):
        pos, ideo = c['pos'], c['ideo']
        if big:
            if pos == 'периферия': return None
            pr = 3 if pos == 'ядро' else 4
        else:
            pr = PERI_HOSP if pos == 'периферия' else 1
            if p.seg >= 4 and p.cidx in p.citizen and s.free_old(p, c): return 0
            if ideo in ('Социал-демократия', 'Госсоциализм') and ('freeh', p.seg) not in p.used_seg and p.cidx in p.citizen: return 0
        if ideo == 'Либеральная демократия': pr += 1
        return pr

    def psy_price(s, p, c, big=False):
        pos, ideo = c['pos'], c['ideo']
        if ideo == 'Теократия': return None
        if big:
            if pos == 'периферия' or ideo == 'Военная диктатура': return None
            pr = 3 if pos == 'ядро' else 4
        else:
            pr = 2 if pos == 'периферия' else 1
            if ideo == 'Социал-демократия' and ('freep', p.seg) not in p.used_seg and p.cidx in p.citizen: return 0
        if ideo == 'Либеральная демократия': pr += 1
        return pr

    def free_old(s, p, c):
        ideo = c['ideo']
        if ideo in ('Госсоциализм', 'Социал-демократия'): return True
        if ideo == 'Национализм': return not p.minority
        if ideo == 'Военная диктатура': return p.cls == 'Армия' or p.stazh >= 5
        if ideo == 'Теократия':
            if p.seg == 5: return True
            ok = roll3(1 if p.predisp == 'Мудрость' else 0) + p.st['Мудрость'] >= 12; s.stats['chk_Мудрость_старцы'] += 1; return ok
        if ideo == 'Клептократия': return p.cls in ('Полиция', 'Олигархи')
        return False

    def do(s, p, name, **d):
        s.stats['mk_' + name] += 1; p.n_mk += 1; p.log['mk_' + name] += 1; p.segs[name].add(p.seg)
        for k, v in d.items():
            if k == 'vozm': p.vozm += v
            elif k == 'phys': p.phys = min(10, p.phys + v)
            elif k == 'psy': p.psy = min(10, p.psy + v)
            else: p.st[k] = min(p.cap(k), p.st[k] + v)
        if name in ('Психолог', 'Психолог+'): p.n_psy += 1
        if name.startswith('Больница'): p.n_hosp += 1
        if name in ('Психолог+', 'Больница+') and p.habit: p.habit = False; s.stats['habit_off'] += 1
        if name in ('Бар', 'Бордель'):
            p.vice[p.seg] += 1
            if p.vice[p.seg] == 3 and not p.habit: p.habit = True; p.log['habit_got'] += 1; s.stats['habit_on'] += 1

    def market(s, p):
        seg = p.seg; c = s.country(p)
        cost = 1 if seg == 2 else (2 if p.cls in ('Мафия', 'Олигархи') else 1)
        p.vozm -= cost; s.stats['spend'] += cost
        if seg >= 4 and p.stazh >= 5 and p.cidx in p.citizen:
            pen = min(3 if p.stazh >= 10 else 2 if p.stazh >= 7 else 1, s.income(p)); p.vozm += pen; s.stats['pension'] += pen
        if seg == 5:
            if p.vozm >= 4: p.vozm -= 2; s.stats['mk_Сиделка'] += 1
            else: p.phys -= 1
        hb = s.hosp_price(p, c, True); pb = s.psy_price(p, c, True)
        if p.phys <= -6 and hb is not None and p.vozm >= hb:
            s.do(p, 'Больница+', vozm=-hb, phys=2); return s.after(p)
        if (p.psy <= -6 or (p.habit and p.psy <= -1 and p.vozm >= (pb or 99) + 2)) and pb is not None and p.vozm >= pb:
            s.do(p, 'Психолог+', vozm=-pb, psy=2); return s.after(p)
        s.work(p, c)
        s.small(p, c)
        s.after(p)

    def after(s, p):
        if p.phys <= -10 or p.psy <= -10:
            p.phys = max(-9, p.phys); p.psy = max(-9, p.psy); p.skip = 1; s.stats['sryv'] += 1
        p.clampv(); p.track()
        if p.seg >= 2 and p.vozm <= 0: p.log['broke'] += 1

    def wear(s, p, how, kind):
        """Износ здоровья от работы (WORK3). kind: 'физ' / 'псих' — своё здоровье класса."""
        own, oth = ('phys', 'psy') if kind == 'физ' else ('psy', 'phys')
        def hit(a, n=1):
            if FLOOR8 and getattr(p, a) <= -8:   # по здоровью на −8 и ниже не бьёт: потеря уходит в другое
                a = 'psy' if a == 'phys' else 'phys'; s.stats['wear_floor8'] += 1
            setattr(p, a, getattr(p, a) - n)
        r = d6(); s.stats['wear_' + how + '_' + str((r + 1) // 2)] += 1
        if how == 'podr':   # 7-й прогон: d6 1–4 — −1 к тому здоровью, что выше; 5–6 — без потерь
            if r <= 4: hit('phys' if p.phys >= p.psy else 'psy')
        elif how == 'rab':
            if r <= 2: hit('phys'); hit('psy')
            elif r <= 4: hit(own if d6() <= 4 else oth)
        elif how == 'per':
            if r <= 2: hit('phys', 2); hit('psy', 2)
            elif r <= 4: hit('phys'); hit('psy')
            else: hit(own)

    def work(s, p, c):
        if p.seg >= 5 or p.psy <= -8: return
        tgt = 10; wn = p.wants
        if wn and wn['vozm'] is not None: tgt = max(tgt, min(p.vcap(), wn['vozm']))
        if p.vozm >= p.vcap() - 3 and p.vozm >= tgt: return
        if p.vozm >= tgt and random.random() > 0.3: return
        if 6 <= p.vozm < 10 and tgt <= 10 and random.random() > 0.6: return
        D = s.income(p); kind = WCOST[p.cls]
        own = p.phys if kind == 'физ' else p.psy if kind == 'псих' else min(p.phys, p.psy)
        if p.student and p.seg == 2:
            stip = 1 if (c['ideo'] == 'Госсоциализм' and 'S' in GS_EDU) else 0
            p.vozm += (D + 1) // 2 + stip; s.stats['mk_Подработка'] += 1; s.stats['student_turn'] += 1
            if WORK3: s.wear(p, 'podr', kind)
            elif PODR_ALL or d6() <= 3:
                if p.phys >= p.psy: p.phys -= 1
                else: p.psy -= 1
            return
        if p.items.get('Без документов', 0):
            p.vozm += (D + 1) // 2; s.stats['mk_Подработка'] += 1; s.stats['nodoc_turn'] += 1; p.nodoc_t += 1
            if WORK3: s.wear(p, 'podr', kind)
            elif p.phys >= p.psy: p.phys -= 1
            else: p.psy -= 1
            if p.nodoc_t % 3 == 0 and roll3() + p.st['Смекалка'] >= 15: p.drop_item('Без документов'); s.stats['legalized'] += 1
            return
        if p.psy <= -5 or own <= -4:
            p.vozm += (D + 1) // 2; s.stats['mk_Подработка'] += 1
            if WORK3: s.wear(p, 'podr', kind)
            elif PODR_ALL or d6() <= 3:
                if p.phys >= p.psy: p.phys -= 1
                else: p.psy -= 1
            return
        if p.phys >= 3 and p.psy >= 3 and p.vozm < 2 and p.seg < 4:
            p.vozm += 2 * D + 1; p.stazh += 1; p.stazh_here += 1; s.stats['mk_Переработка'] += 1
            if WORK3 and kind in ('физ', 'псих'): s.wear(p, 'per', kind)
            elif kind == 'физ': p.phys -= 2; p.psy -= 1
            elif kind == 'псих': p.psy -= 2; p.phys -= 1
            else:
                p.phys -= 1; p.psy -= 1
                if d6() <= 2: p.add_item('Дурная слава', 'стигма'); s.stats['item_стигма_Дурная слава (работа)'] += 1
            return
        p.vozm += D + 1; p.stazh += 1; p.stazh_here += 1; s.stats['mk_Работа'] += 1
        if WORK3 and kind in ('физ', 'псих'): s.wear(p, 'rab', kind)
        elif kind == 'физ':
            p.phys -= 1
            if d6() <= WORK2: p.psy -= 1
        elif kind == 'псих':
            p.psy -= 1
            if d6() <= WORK2: p.phys -= 1
        elif d6() == 1: p.add_item('Дурная слава', 'стигма'); s.stats['item_стигма_Дурная слава (работа)'] += 1

    def small(s, p, c):
        seg = p.seg; pos = c['pos']; ideo = c['ideo']
        hp = s.hosp_price(p, c); pp = s.psy_price(p, c); wn = p.wants; fl = wn['flags'] if wn else set()
        nodoc = p.items.get('Без документов', 0) > 0
        rite_ok = p.cidx == p.birth_c or s.diaspora[(p.cidx, p.culture)]
        if nodoc:   # «Без документов»: только ловушки, больница и обряд
            if p.phys <= HOSP_T and hp is not None and p.vozm >= hp: s.do(p, 'Больница', vozm=-hp, phys=1); return
            if rite_ok and ('rite', seg) not in p.used_seg:
                p.used_seg.add(('rite', seg)); s.rite(p); return
            if p.psy <= -2 and p.vozm >= 1 and random.random() < 0.15: return s.trap(p, random.choice(['Бар', 'Казино', 'Лотерея', 'Бордель']))
            s.stats['mk_ничего'] += 1; return
        psy_t = PSY_T
        if wn and wn['psy'] is not None and p.psy < wn['psy'] and p.seg >= 3: psy_t = max(PSY_T, wn['psy'] - 1)
        if p.phys <= HOSP_T and hp is not None and p.vozm >= hp:
            if hp == 0 and ideo in ('Социал-демократия', 'Госсоциализм') and not (seg >= 4): p.used_seg.add(('freeh', seg))
            s.do(p, 'Больница', vozm=-hp, phys=1); return
        if p.psy <= psy_t:
            if ideo == 'Теократия':
                if ('conf', seg) not in p.used_seg: p.used_seg.add(('conf', seg)); s.do(p, 'Исповедь', psy=1); p.n_psy += 1; return
                if p.psy > -8 and p.vozm >= 1: s.temple(p); return
            elif pp is not None and p.vozm >= pp + (0 if p.psy <= PSY_T else 2):
                if pp == 0: p.used_seg.add(('freep', seg))
                s.do(p, 'Психолог', vozm=-pp, psy=1); return
        r = random.random()
        if p.psy <= -3 and p.vozm < 1 and r < 0.5:
            if random.random() < 0.5: s.do(p, 'Обжорство', psy=1, phys=-1 if d6() <= 2 else 0)
            else: s.do(p, 'Микрозаймы', vozm=4); p.micro += 1
            return
        if p.psy <= -2 and r < 0.10 and p.vozm >= 1:
            t = random.choice(['Бар', 'Казино', 'Лотерея', 'Бордель'])
            return s.trap(p, t)
        # игра на смысл: точечные шаги, которых требует карта
        if wn and p.psy > -5:
            if 'vice' in fl and p.vozm >= 3:
                for t, key in (('Бар', 'mk_Бар'), ('Казино', 'mk_Казино'), ('Бордель', 'mk_Бордель')):
                    if p.log[key] == 0: return s.trap(p, t)
                if p.log['casino_win'] == 0 and random.random() < 0.3: return s.trap(p, 'Казино')
            if 'donate' in fl and p.vozm >= 5 and random.random() < 0.5:
                s.do(p, 'Благотворительность', vozm=-2, psy=1); s.stats['donations'] += 1; p.donations += 1; p.don_since += 1; return
            if 'temple' in fl and ('Храм' not in p.segs or seg not in p.segs['Храм']) and p.vozm >= 2 and random.random() < 0.7: s.temple(p); return
            if 'hobby' in fl and ('hobby', seg) not in p.used_seg and p.vozm >= 2 and random.random() < 0.7:
                p.used_seg.add(('hobby', seg)); return s.hobby(p)
            if 'zapoved' in fl and p.phys >= 1 and p.vozm >= 1 and random.random() < 0.4: s.do(p, 'Заповедник', phys=-2, psy=1); return
            if 'rite' in fl and ('rite', seg) not in p.used_seg and rite_ok:
                p.used_seg.add(('rite', seg)); s.rite(p); return
        if rite_ok and ('rite', seg) not in p.used_seg and (p.psy < 3 or p.phys < 2 or random.random() < 0.3 or (p.cidx != p.birth_c and 'emig' in fl)):
            p.used_seg.add(('rite', seg)); s.rite(p); return
        if p.coh >= 1 and ('fam', seg) not in p.used_seg and (p.vozm < 0 or p.psy < 0):
            amt = 1 if p.cidx != p.birth_c else 2
            p.used_seg.add(('fam', seg)); s.do(p, 'Семья', **({'vozm': amt} if p.vozm < 0 else {'psy': amt})); return
        if p.vozm < -3 and p.psy > -5 and not p.items.get('Долг') and not p.items.get('Судимость') and ideo != 'Госсоциализм' and random.random() < 0.3:
            s.do(p, 'Банк', vozm=4 if pos == 'ядро' else 3); p.debts += 5 if pos == 'ядро' else 4; return
        if p.vozm >= 5 and p.psy > -5:
            pr = MKT_PRICE + (PERI_SHOP if pos == 'периферия' else 0)
            cand = [k for k in ['Сила', 'Выносливость', 'Ловкость'] if p.st[k] < (8 if k == p.predisp else 7)] if p.phys > -5 and seg < 4 else []
            cand2 = [k for k in ['Интеллект', 'Мудрость', 'Харизма', 'Смекалка'] if p.st[k] < (8 if k == p.predisp else 7)]
            a1, a2 = INC[p.cls][1:]
            want = []
            if wn:   # характеристики смысла — в приоритете
                want = [k for k, n in sorted(wn['stats'].items(), key=lambda x: x[1] - p.st[x[0]]) if p.st[k] < n and p.st[k] < p.cap(k)
                        and (k in cand2 or (k in ('Сила', 'Выносливость', 'Ловкость') and p.phys > -5 and seg < 4))]
                if 'courses' in fl and seg not in p.segs['Курсы']: want = want + [x for x in cand2 if x not in want][:1]
            want += [k for k in (a1, a2) if k in cand + cand2 and k not in want]
            if want and p.vozm >= pr + 2 and random.random() < 0.7:
                k = want[0]
                if k in cand2 and ideo == 'Национализм' and p.minority: pr += 1
                if k == 'Красота': s.do(p, 'Салон', vozm=-pr, Красота=2 if pos == 'полупериферия' else 1); s.salon6(p); return
                if k in ('Сила', 'Выносливость', 'Ловкость'):
                    if GYM_CHEAP and ideo in ('Военная диктатура', 'Госсоциализм'): pr = max(1, pr - 1)
                    s.do(p, 'Спортзал', vozm=-pr, **{k: 1})
                    if d6() == 6: p.phys = min(10, p.phys + 1)
                else:
                    s.do(p, 'Курсы', vozm=-pr, **{k: 1})
                    if d6() == 6: p.add_item('Учитель', 'связь'); s.stats['item_связь_Учитель (курсы)'] += 1
                return
            if p.st['Красота'] < 7 and random.random() < 0.25 and p.vozm >= pr + 2:
                s.do(p, 'Салон', vozm=-pr, Красота=2 if pos == 'полупериферия' else 1); s.salon6(p); return
        if p.vozm >= 7 and ('travel', seg) not in p.used_seg and p.psy < 4 and p.phys > -5 and p.psy > -5 and random.random() < 0.35:
            p.used_seg.add(('travel', seg)); s.do(p, 'Путешествие', vozm=-5, psy=2, Мудрость=1)
            if TRAVEL_KID and p.items.get('Партнёр', 0) + p.items.get('Супруг', 0) > 0 and p.v_child > 0 and seg in (2, 3):
                s.stats['travel_kid_try'] += 1
                if d6() >= 5: p.add_child(); s.stats['travel_kid'] += 1
            return
        if ('hobby', seg) not in p.used_seg and p.psy < 5 and p.psy > -5 and p.vozm >= 2 and random.random() < 0.35:
            p.used_seg.add(('hobby', seg)); return s.hobby(p)
        if p.psy < 3 and p.psy > -8 and p.vozm >= 2 and random.random() < 0.3: s.temple(p); return
        if p.vozm >= 8 and random.random() < 0.15:
            s.do(p, 'Благотворительность', vozm=-2, psy=1); s.stats['donations'] += 1; p.donations += 1; p.don_since += 1; return
        if p.vozm >= 8 and random.random() < 0.06: s.do(p, 'Заповедник', phys=-2, psy=1); return
        if p.phys < 3 and hp is not None and p.vozm >= hp + 2: s.do(p, 'Больница', vozm=-hp, phys=1); return
        if p.psy < 3 and pp is not None and p.vozm >= pp + 2: s.do(p, 'Психолог', vozm=-pp, psy=1); return
        s.stats['mk_ничего'] += 1

    def rite(s, p):
        d = RITES[p.culture]
        s.do(p, 'Обряд', **{('psy' if k == 'псих' else 'phys' if k == 'физ' else k): v for k, v in d.items()})
        if p.cidx != p.birth_c: p.log['rite_abroad'] += 1

    def trap(s, p, t):
        if t == 'Бар': s.do(p, 'Бар', vozm=-1, psy=2, phys=-1 if d6() <= 2 else 0)
        elif t == 'Бордель' and p.vozm >= 2:
            s.do(p, 'Бордель', vozm=-2, psy=3)
            if BROTHEL_KID and random.randint(1, 12) == 1:
                p.add_child(); p.psy -= 2; s.stats['bastard'] += 1
                if p.items.get('Супруг', 0): p.lose_spouse(True)
                elif p.items.get('Партнёр', 0): p.items['Партнёр'] = 0
        elif t == 'Казино':
            x = d6(); s.do(p, 'Казино', vozm=-1 if x <= 3 else 0 if x <= 5 else 2, psy=-1 if x <= 3 else 2 if x == 6 else 0)
            if x == 6: p.log['casino_win'] += 1
        else: s.do(p, 'Лотерея', vozm=-1 + (3 if d6() == 6 else 0))

    def salon6(s, p):
        if SALON6 and d6() == 6: p.psy += 1; s.stats['salon6'] += 1

    def hobby(s, p):
        s.do(p, 'Хобби', vozm=-1, psy=1)
        x = d6()
        if x == 6: p.add_item('Друг', 'связь'); s.stats['item_связь_Друг (хобби)'] += 1
        elif x == 5 and p.st['Ловкость'] < 7: p.st['Ловкость'] += 1; s.stats['hobby_dex'] += 1

    def temple(s, p):
        theist = p.axes[4] < 0
        s.do(p, 'Храм', vozm=-1, psy=2 if theist else 1)
        if d6() == 6: p.add_item('Духовник', 'связь'); s.stats['item_связь_Духовник (храм)'] += 1

    def youth_market(s, p):
        if p.youth_used >= 3 or random.random() > 0.35: return
        p.youth_used += 1; s.stats['youth_market'] += 1

    def upbringing(s, p, seg):
        """«Итог воспитания» в конце Детства (seg=1) и в конце Юности (seg=2)."""
        if seg == 2: p.upb2 = True
        pts = {-3: 0, -2: 0, -1: 1, 0: 1, 1: 2, 2: 2, 3: 3}[p.fin] + (1 if p.coh >= 2 else 0) + p.parent_wmod
        pts = max(0, pts)
        if p.coh <= -2: pts //= 2; p.st['Смекалка'] += 1
        a, b = RAISE[p.cls]
        for i in range(pts): k = a if i % 2 == 0 else b; p.st[k] = min(10, p.st[k] + 1)
        if seg == 2: p.st['Красота'] = min(10, p.st['Красота'] + random.randint(1, 4))
        elif p.fin <= -2: p.st['Красота'] = max(0, p.st['Красота'] - 1)

    def seg_enter(s, p, seg):
        p.maxseg = max(p.maxseg, seg)
        if seg == 1 or (seg == 2 and not p.upb2): s.upbringing(p, seg)
        if seg == 2 and not FORKS:
            if (p.st['Интеллект'] >= 4 or p.fin >= 1) and random.random() < 0.6: p.add_item('Диплом', 'статус'); s.stats['diploma_old'] += 1
        # смысл: поиск, отказ от предназначения, кризис
        if p.refusing and seg in (1, 2):
            if not p.refuse_roll(13 if seg == 1 else 10) and seg == 2: p.refusing = False; s.stats['refuse_stop'] += 1
        if seg == 1: p.meaning_roll(13)
        if seg == 2:
            p.meaning_roll(10)
            if p.inherit is not None:   # наследство ребёнку — при входе в Молодость
                p.vozm += p.inherit['vozm']; p.debts += p.inherit.get('debts', 0)
                for k in p.inherit.get('trumps', []): p.items[k] += 1; p.itype[k] = 'козырь'; p.log['trump_got'] += 1
                s.stats['inherit_child'] += 1; s.stats['inherit_vozm_child'] += p.inherit['vozm']; p.inherit = None; p.clampv()
        if seg == 3:
            if p.card is not None and not p.crisis_done:
                p.score_Z = MN.score(p.card, p); p.card_Z = p.card['id']; s.crisis(p)
            p.crisis_done = True
            if p.card is None:
                p.meaning_roll(10)
                if p.card is None: p.grey = True; p.set_card(GREY, 'grey')
                p.score_Z = MN.score(p.card, p); p.card_Z = p.card['id']
            if FORKS and 'Z' in GS_EDU and not p.zaoch_done: s.zaochnoe(p)
        if ARMY_KEYS and seg == 2 and p.cls == 'Армия' and not p.items.get('Присяга', 0) and p.cidx in p.citizen:
            p.add_item('Присяга', 'статус'); s.stats['oath_army'] += 1
        if ARMY_KEYS and seg == 3 and p.cls == 'Армия' and p.items.get('Присяга', 0) and p.stazh >= 5 and not p.items.get('Офицерское звание', 0):
            if roll3() + max(p.st['Интеллект'], p.st['Харизма']) >= 12: p.add_item('Офицерское звание', 'статус'); s.stats['rank_army'] += 1
        s.emig_seg(p, seg)
        if not p.alive: return
        if seg in (4, 5): p.st['Красота'] = max(0, p.st['Красота'] - 1)
        if p.habit: p.psy -= 1; s.stats['habit_tax'] += 1
        # снятие стигм временем
        if p.items.get('Дурная слава', 0) > 0:
            if any(k.startswith('Имя') and v > 0 for k, v in p.items.items()): p.drop_item('Дурная слава'); s.stats['dslava_off_name'] += 1
            elif p.don_since >= 2: p.items['Дурная слава'] -= 1; p.don_since = 0; s.stats['dslava_off_don'] += 1; (p.log.update({'stigma_off': 1}) if p.items['Дурная слава'] == 0 else None)
            elif p.stig_new == 0: p.items['Дурная слава'] -= 1; s.stats['dslava_off_time'] += 1; (p.log.update({'stigma_off': 1}) if p.items['Дурная слава'] == 0 else None)
        for nm in ('Судимость', 'Учёт'):   # «гаснет после целого отрезка без нарушений»
            if p.items.get(nm, 0) > 0 and p.inst is None and p.last_prison_seg is not None and p.last_prison_seg <= seg - 2 and p.stig_new == 0:
                p.drop_item(nm); s.stats['off_' + nm] += 1
        p.stig_new = 0
        if seg == 5:
            c = s.country(p); mod = (1 if c['pos'] == 'ядро' else DREV_PER if c['pos'] == 'периферия' else 0) + (1 if p.vozm >= 10 else 0)
            s.stats['drev_check_n'] += 1
            if roll3() + p.phys + mod < DREV_T:
                p.seg = 4; p.maxseg = 4; p.die('возраст (вход в Древность)'); return
        if p.debts: p.vozm -= p.debts; p.debts = 0
        if p.micro:
            p.vozm -= 6 * p.micro
            if p.vozm < -10: p.add_item('Долг', 'стигма'); s.stats['item_стигма_Долг (микрозаймы)'] += 1
            p.micro = 0
        p.clampv()
        p.entry[seg] = dict(phys=p.phys, psy=p.psy, vozm=p.vozm, cls=p.cls, spouse=p.items.get('Супруг', 0) > 0)
        s.stats['enter_' + SEGS[seg]] += 1

    def step(s, p):
        if not p.alive or p.done: return
        p.turns += 1
        if p.skip > 0:
            p.skip -= 1; s.stats['skip_turn'] += 1; return
        if p.inst:
            if p.inst == 'Кабала':
                p.vozm += 2; s.stats['turn_Кабала'] += 1
                if p.kab_t % 2 == 0: p.phys = max(-9, p.phys - 1)
                else: p.psy = max(-9, p.psy - 1)
                p.kab_t += 1
                if p.vozm >= -8: p.leave(); p.add_item('Долг', 'стигма')
                p.check_death('кабала'); return
            s.stats['turn_' + p.inst] += 1
            exec_text(card_effect(random.choice(DECK[p.inst])), p, s, p.seg)
            p.inst_left -= 1
            if p.inst == 'Психбольница' and p.psy >= 0: p.inst_left = 0
            if p.inst_left <= 0 and p.inst: p.leave()
            p.cell += 1
            return
        old = p.cell; p.cell += d6(); tgt = p.cell
        seglen = 30 + (2 if 1 <= p.seg <= 4 else 0)
        # обязательные остановки на напечатанных развилках; после развилки фишка доходит остаток хода (FORK_BURN=0)
        fk = None
        if FORKS and p.seg == 1 and not p.edu_done and p.cell >= seglen - 1:
            p.cell = fk = seglen - 1; p.edu_done = True; s.upbringing(p, 2); s.education(p)
            if FORK_BURN: return
        elif FORKS and p.seg == 2 and not p.emig_done and old < 8 <= p.cell:
            p.cell = fk = 8; s.emig_fork(p)
            if FORK_BURN: return s.post(p, 2)
        elif FORKS and p.seg == 2 and not p.part_done and old < 20 <= p.cell:
            p.cell = fk = 20; s.partnership(p)
            if FORK_BURN: return s.post(p, 2)
        elif CHILD_FORK and p.seg == 3 and not getattr(p, 'kid_done', False) and old < 10 <= p.cell:
            p.cell = fk = 10; p.kid_done = True; s.stats['fork_child'] += 1
            if p.items.get('Партнёр', 0) + p.items.get('Супруг', 0) > 0: s.child_fork(p)
            if FORK_BURN: return s.post(p, 3)
        if fk is not None:
            if not p.alive or p.inst or tgt == fk: return s.post(p, p.seg) if p.alive and not p.inst and p.seg >= 2 else None
            p.cell = tgt; s.stats['fork_walk_on'] += 1
        if p.cell >= seglen:
            if p.seg == 5: p.done = True; s.stats['finished_life'] += 1; return
            p.seg += 1; p.cell -= seglen; s.seg_enter(p, p.seg)
            if not p.alive: return
        seg = p.seg
        if p.student and seg == 2 and p.cell >= 15: s.graduate(p)
        w = CELLS[seg] + ([2] if 1 <= seg <= 4 else [0])
        t = random.choices(CTYPES + ['Класс'], weights=w)[0]
        s.stats['cell_' + t] += 1
        if t == 'Возраст': s.draw(SEGS[seg], p, seg)
        elif t == 'Класс': s.draw(('Класс', p.cls), p, seg)
        elif t == 'Тихая': pass
        else: s.draw(t, p, seg)
        s.post(p, seg)

    def post(s, p, seg):
        if p.student and seg == 2 and p.cell >= 15: s.graduate(p)
        if p.alive and seg >= 2 and not p.inst and p.skip == 0:
            if seg == 2: s.youth_market(p)
            s.market(p)
            if p.vozm <= p.vfloor(): p.enter('Кабала', 99); s.stats['kab_pos_' + s.country(p)['pos']] += 1
        p.min_v = min(p.min_v, p.vozm); p.max_v = max(p.max_v, p.vozm); p.track()
        if p.cls == 'Олигархи' and p.items.get('Судимость', 0) > 0: p.log['olig_sud'] += 1
        if p.psy <= -5: p.lowpsy += 1
        if p.phys <= -5: p.lowphys += 1

    def world_turn(s):
        s.stats['world_turns'] += 1; s.wt += 1
        for c in s.countries: c['war'] = False
        for ci, c in enumerate(s.countries):
            if roll3() >= 8 + c['stab']:
                c['crises'] += 1; s.stats['crisis'] += 1
                if roll3() >= 11:
                    c['changes'] += 1; s.stats['power_change'] += 1
                    old = c['dom']; c['dom'] = c['ali']; c['ali'] = old
                    opts = {'Народ': ['Госсоциализм', 'Социал-демократия', 'Национализм'], 'Армия': ['Военная диктатура'], 'Полиция': ['Национализм', 'Военная диктатура'],
                            'Олигархи': ['Клептократия', 'Либеральная демократия'], 'Интеллигенция': ['Либеральная демократия', 'Социал-демократия'], 'Мафия': ['Клептократия']}
                    c['ideo'] = random.choice(opts[c['dom']]); c['stab'] = 4
                    for p in s.players:
                        if p and p.alive and not p.done and p.cidx == ci:
                            card = random.choice(DECK['Смута']); s.stats['smuta_card'] += 1; s.cur_card = 'Смута | ' + str(card.get('Карта')); s.cur_full = ''
                            wn = p.wants
                            if wn and 'side' in wn['flags']: side = random.choice(['Победители', 'Проигравшие'])
                            else: side = random.choice(['Победители', 'Проигравшие', 'Нейтралы', 'Нейтралы'])
                            cls0 = p.cls; keep = {k: p.items.get(k, 0) > 0 for k in ('Присяга', 'Значок')}
                            exec_text(card.get('Для всех', ''), p, s, p.seg); exec_text(card.get(side, ''), p, s, p.seg)
                            txt = ' '.join(str(v) for v in card.values())
                            if c['ideo'] in ('Военная диктатура', 'Госсоциализм', 'Теократия', 'Национализм') and 'не действует' not in txt and p.inst is None and p.alive:
                                lose = side == 'Проигравшие' or (side == 'Нейтралы' and (SMUTA_N == 'all' or c['ideo'] == 'Военная диктатура') and roll3() + p.st['Смекалка'] < 12)
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
                    s.flight_chance(ci, 'power')
                else:
                    c['stab'] = min(10, c['stab'] + 2)
            else:
                c['stab'] = min(10, c['stab'] + 1 - (1 if c['conflict'] else 0) - (1 if c['ali'] == 'Народ' else 0))
        card = random.choice([x for x in DECK['Мир'] if x.get('Карта') not in THAW]); nm = card.get('Карта'); s.gstat[nm] += 1; s.stats['world_' + card.get('Охват', '?')] += 1
        ci = random.randrange(5)
        if nm == 'Война': s.countries[ci]['war'] = True
        if nm == 'Мировая война':
            for c in s.countries:
                if c['conflict'] or random.random() < 0.5: c['war'] = True
        m = re.search(r'стабильность\s*([+−-])\s?(\d)', card.get('Страна', ''))
        if m: s.countries[ci]['stab'] += int(m.group(2)) * (1 if m.group(1) == '+' else -1)
        s.cur_card = 'Мир | ' + str(nm); s.cur_full = ''
        for p in s.players:
            if p and p.alive and not p.done and (card.get('Охват', '') != 'местный' or p.cidx == ci):
                exec_text(card.get('Игроки', ''), p, s, p.seg)
                if nm in ('Пандемия', 'Мировая война') and p.alive: p.log['global'] += 1
        for p in s.players:
            if p and p.alive and not p.done and p.seg >= 2 and s.countries[p.cidx]['war']: p.log['war'] += 1
        for cj, c in enumerate(s.countries):
            if c['war']: s.flight_chance(cj, 'war')
        if nm == 'Чистка': s.flight_chance(ci, 'purge')

    # ---------- жизнь закончилась: счастье, наследник ----------
    def close(s, p, end=False):
        p.closed = True
        if p.card is not None:
            p.happy, got = MN.score(p.card, p, detail=True)
            p.got = [i for i, cd in enumerate(p.card['conds']) if cd[1] in got]
        else: p.happy = 0.0
        p.end_round = s.round; p.end_alive = end
        s.lives.append(p)

    def heir(s, p):
        i = p.seat
        if p.kids_metr:
            m = dict(p.kids_metr[0]); m['inherit'] = dict(vozm=p.vozm, debts=p.debts, trumps=[k for k, v in p.items.items() if v > 0 and p.itype.get(k) == 'козырь'])
            m['cidx'] = p.cidx; m['citizen'] = set(p.citizen) | {p.cidx}
            s.stats['heir_child'] += 1
            return Player(s, p.i, metr=m, gen=p.gen + 1, seat=i, born=s.round)
        r = d6() + p.coh
        if r <= 1: s.cut[i] = True; s.stats['lineage_cut'] += 1; return None
        lst = STD[p.cls]; k = 0 if d6() <= 3 else 1
        taken = {q.std_name for q in s.players if q and getattr(q, 'std_name', None)}
        cand = [lst[k], lst[1 - k]]
        cand = [c for c in cand if c['name'] not in s.std_used[i] and c['name'] not in taken]
        if not cand:
            rest = [c for l2 in STD.values() for c in l2 if c['name'] not in s.std_used[i] and c['name'] not in taken]
            if not rest: s.cut[i] = True; s.stats['lineage_cut_nocards'] += 1; return None
            cand = [random.choice(rest)]; s.stats['std_random'] += 1
        sc = cand[0]; s.std_used[i].add(sc['name']); s.stats['heir_std'] += 1
        q = Player(s, p.i, std=(sc, p), gen=p.gen + 1, seat=i, born=s.round); q.std_name = sc['name']
        return q

    def sweep(s):
        for i, p in enumerate(s.players):
            if p is None or p.closed: continue
            if not p.alive or p.done:
                s.close(p)
                s.players[i] = s.heir(p) if MODE == 'rod' else p

    def run(s):
        for r in range(1, s.rounds + 1):
            s.round = r
            for p in list(s.players):
                if p is not None and not p.closed: s.step(p)
            s.sweep()
            if r % 5 == 0: s.world_turn(); s.sweep()
        for p in s.players:
            if p is not None and not p.closed: s.close(p, end=True)
        return s

    def epoch(s):
        pc = sum(c['changes'] for c in s.countries); mx = max(c['changes'] for c in s.countries)
        g = s.gstat
        idx = sum(world_index(k) * v for k, v in g.items()) - pc
        wars = g['Война'] + g['Мировая война']
        mean_l = sum(1 for p in s.lives if p.happy >= 7 and not (p.card and p.card['deck'] == 'grey')); empty_l = sum(1 for p in s.lives if p.happy <= 3)
        idx += 2 * mean_l - empty_l
        if EPOCH2 and MODE == 'rod':   # доли смыслов — по завершённым жизням тех, кто вырос в семье
            L = [p for p in s.lives if p.heir != 'std' and not p.end_alive]
            mean_e = sum(1 for p in L if p.happy >= 7 and not (p.card and p.card['deck'] == 'grey')); empty_e = sum(1 for p in L if p.happy <= 3); n_e = len(L)
        else: mean_e, empty_e, n_e = mean_l, empty_l, len(s.lives)
        mir = sum(p.miracles for p in s.lives); idx += mir
        idx += sum(1 if c['stab'] >= 8 else -1 if c['stab'] <= 2 else 0 for c in s.countries)
        idx += sum(p.donations for p in s.lives) // 5
        idx += sum(1 for p in s.lives if not p.crossed)
        idx -= sum(s.cut)
        calm = sum(v for k, v in g.items() if k.startswith('Спокойные'))
        k = max(1.0, s.wt / 10)
        ash = g['Пандемия'] + g['Мировая война'] >= 2 * k; fear = g['Чистка'] >= 2 * k; coup = mx >= 4 * k
        n = len(s.lives)
        if ash: e = 'Эпоха пепла'
        elif fear: e = 'Эпоха страха'
        elif coup: e = 'Эпоха переворотов'
        elif calm >= s.wt / 2 and empty_e > mean_e: e = 'Эпоха серых пальто'
        elif n_e and mean_e >= MEAN_SHARE * n_e: e = 'Эпоха смыслов'
        elif (mir >= 7 * k) if EPOCH2 else (mir > wars): e = 'Эпоха чудес'
        else: e = 'Золотой век' if idx >= 15 else 'Тёплые годы' if idx >= 6 else 'Межвременье' if idx >= -5 else 'Железный век' if idx >= -14 else 'Новая Последняя война'
        return idx, e, dict(mean_l=mean_l, empty_l=empty_l, n=n, mean_e=mean_e, empty_e=empty_e, n_e=n_e, calm=calm, pc=pc, mx=mx, wars=wars, mir=mir)


def ladder(h):
    sc = 0
    for a, b in zip(h, h[1:]): sc += 2 if b > a else -1 if b < a else 0
    return sc

def ladder2(gens):
    g = list(gens)
    if len(g) > 1 and g[-1].end_alive and g[-1].maxseg < 3: g = g[:-1]
    sc = 0
    for a, b in zip(g, g[1:]):
        if b.heir != 'child': continue
        sc += 2 if b.happy > a.happy else -1 if b.happy < a.happy else 0
    return sc

if __name__ == '__main__':
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    OUT = sys.argv[3] if len(sys.argv) > 3 else 'result3.json'
    random.seed(int(E('SEED', '1')))
    tot = C.Counter(); rows = []; games = []
    for g in range(N):
        w = World(ROUNDS).run()
        tot.update(w.stats)
        idx, ep, info = w.epoch()
        seats = []
        for i in range(4):
            gens = sorted([p for p in w.lives if p.seat == i], key=lambda p: p.gen)
            h = [p.happy for p in gens]
            seats.append(dict(h=h, ladder=ladder(h), ladder2=ladder2(gens), cut=w.cut[i], maxseg=[p.maxseg for p in gens], types=[p.heir for p in gens], alive_end=[p.end_alive for p in gens],
                              born=[p.born for p in gens], ends=[p.end_round for p in gens], cls=[p.cls for p in gens], fin0=[p.fin0 for p in gens],
                              cls0=[p.cls0 for p in gens], vozm=[p.vozm for p in gens], names=[sum(1 for k, v in p.items.items() if k.startswith('Имя') and v > 0) for p in gens],
                              wins=[p.log['smuta_win'] for p in gens]))
        games.append(dict(idx=idx, ep=ep, info=info, seats=seats, wt=w.wt))
        for p in w.lives:
            c = w.countries[p.cidx]
            rows.append(dict(g=g, seat=p.seat, gen=p.gen, heir=p.heir, pos=c['pos'], pos_birth=p.pos_c, ideo0=p.ideo0, ideo=c['ideo'], edu_ideo=p.edu_ideo,
                             cls0=p.cls0, cls=p.cls, fin0=p.fin0, pos0=p.pos0, coh0=p.coh0, coh=p.coh, alive=p.alive, done=p.done, end_alive=p.end_alive,
                             seg=p.seg, maxseg=p.maxseg, death=p.death, happy=p.happy, card=p.card['id'] if p.card else None,
                             cname=p.card['name'] if p.card else None, deck=p.card['deck'] if p.card else None, kind=p.card['kind'] if p.card else None,
                             src=p.card_src, grey=p.grey, swapped=p.swapped, dyn=p.dyn, ref_try=p.ref_try, got=p.got,
                             unreach=p.card['unreach_pts'] if p.card else 0, scoreZ=p.score_Z, cardZ=p.card_Z,
                             W=p.st['Мудрость'], st=p.st, phys=p.phys, psy=p.psy, vozm=p.vozm, stazh=p.stazh, edu=p.edu,
                             dip=p.items.get('Диплом', 0) > 0, spouse=p.items.get('Супруг', 0) > 0, wed=p.log['wed'], kids=p.items.get('ребёнок', 0),
                             partners=p.log['partners'], n_prison=p.n_prison, crossed=p.crossed, born=p.born, end=p.end_round, turns=p.turns,
                             habit=p.habit, donations=p.donations, minority=p.minority, female=p.female, prestige=p.prestige,
                             emig=p.log['emig'], returned=p.log['returned'], flight=p.log['flight'], acc_max=p.log['acc_max'], abroad=p.cidx != p.birth_c,
                             citizen_here=p.cidx in p.citizen, nodocs=p.items.get('Без документов', 0) > 0, oath=p.items.get('Присяга', 0) > 0,
                             rank=p.items.get('Офицерское звание', 0) > 0, gym=p.log['mk_Спортзал'], courses=p.log['mk_Курсы'], salon=p.log['mk_Салон']))
    json.dump(dict(N=N, ROUNDS=ROUNDS, MODE=MODE, env={k: v for k, v in os.environ.items() if k in ('MODE', 'AIMODE', 'GS_EDU', 'EDU_IDEO', 'EDU_GO', 'REFUSE', 'CRISIS', 'PILOT', 'FORKS', 'HRAM_WED', 'V_CHILD', 'V_SPOUSE', 'SEED')},
                   tot=tot, games=games, rows=rows), open(OUT, 'w'), ensure_ascii=False, default=list)
    print('done', N)
