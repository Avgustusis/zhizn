"""«Общественный след» (18.11, прототип): жетоны следа на странах → уступка / имитация / подавление → карта политики.

Шесть каналов, по одному на класс. Жетон кладут:
  — игроки: удачная ветка «карты со следом» (здесь — вероятность Q за ход игрока, если он вытянул событие);
  — мир: каждый мировой ход фон (вместо строки на карте «Мир»): d6 1–3 — жетон в одну случайную страну,
    канал — отчуждённого класса (d6 1–3), доминирующего (4–5) или случайный (6).
Мировой ход: в стране, где жетонов одного канала ≥ PORE, — бросок d6 + поправки:
  1–2 подавление, 3–4 имитация, 5–6 уступка. Жетоны этого канала снимаются. Потом с каждой страны снимается 1 жетон (затухание).
Карта политики лежит LEN мировых ходов: класс канала Д +1, «плательщик» Д −1 (уступка);
подавление — класс канала Д −1, стабильность −1, участники-игроки d6 1–2 — «Дурная слава».
"""
import os, random, collections as C
E = os.environ.get
SOC = E('SOC', '1') == '1'
Q = float(E('SOC_Q', '0.03'))        # шанс, что вытянутое событие игрока оставило след
BG = int(E('SOC_BG', '3'))           # фон: d6 ≤ BG — жетон за мировой ход
BGMODE = E('SOC_BGMODE', 'crisis')   # crisis — жетон отчуждённых, когда бросок кризиса «почти» (5+стаб ≤ 3d6 < 8+стаб)
PORE = int(E('SOC_PORE', '2'))       # порог жетонов одного канала
LEN = int(E('SOC_LEN', '5'))         # срок карты политики, мировых ходов
COUNT = True
SUPP = int(E('SOC_SUPP', '1'))       # итог броска ≤ SUPP — подавление
WIDE = E('SOC_WIDE', '1') == '1'     # уступку оплачивают все остальные классы страны (иначе — один «плательщик»)
DECAY = E('SOC_DECAY', 'quiet')       # quiet — жетон снимается, только если в стране за мировой ход ничего не легло                          # считать попадания (выключается при служебных вызовах)
CH = {'Народ': 'Труд', 'Армия': 'Долг', 'Полиция': 'Порядок', 'Интеллигенция': 'Гласность', 'Олигархи': 'Капитал', 'Мафия': 'Тень'}
CLS = {v: k for k, v in CH.items()}
PAYER = {'Труд': 'Олигархи', 'Долг': 'Интеллигенция', 'Порядок': 'Мафия', 'Гласность': 'Армия', 'Капитал': 'Народ', 'Тень': 'Полиция'}
DEM = {'Либеральная демократия', 'Социал-демократия'}
DICT = {'Военная диктатура', 'Госсоциализм', 'Теократия', 'Полицейское государство'}
d6 = lambda: random.randint(1, 6)
MODE = E('SOC_MODE', 'cards')        # cards — жетон кладут 40 карт ✊ (18.11); q — старый прототип с вероятностью Q
import sys as _sys; _sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data'))
import soc_cards as _SC
TR = {}
for _d, _sub, _no, _n, _br, _ch in _SC.TRACE:
    _k = _sub if _d == 'Возраст' else ('Класс', _sub) if _d == 'Класс' else _d
    _pb = 1.0 if _br.startswith(('успех', 'суд', 'всегда')) else 0.5
    if '4–6' in _br: _pb = 0.25
    if 'диктатуры' in _br: _pb = 0.5
    if 'Цинизм' in _br: _pb = 0.3
    TR[(_k, _n)] = (_pb, _ch, _br)


def init(w):
    for c in w.countries:
        c['soc'] = C.Counter(); c['soc_who'] = C.defaultdict(set); c['pol'] = []   # pol: (класс, ±1, до wt, канал, вид, игроки)


def card_mark(w, p, deck, c, failed):
    """карта ✊: выбранная ветка удалась — жетон канала на страну игрока"""
    if not SOC or MODE != 'cards' or c is None or failed or not p.alive: return
    t = TR.get((deck, c.get('Карта', c.get('Развилка', ''))))
    if not t: return
    pb, ch, br = t
    if 'диктатуры' in br and w.country(p)['ideo'] not in DICT | {'Национализм'}: return
    if random.random() >= pb: return
    if ch == 'свой': ch = CH[p.cls]
    elif ch == '—': ch = random.choice(['Труд', 'Капитал'])
    cc = w.country(p); cc['soc'][ch] += 1; cc['soc_who'][ch].add(id(p)); cc['soc_new'] = True
    w.stats['soc_tok_player'] += 1; w.stats['soc_tok_card_' + ch] += 1


def player_mark(w, p):
    """после события игрока: шанс оставить след своего класса (старый прототип)"""
    if not SOC or MODE == 'cards' or random.random() >= Q: return
    c = w.country(p); ch = CH[p.cls]
    c['soc'][ch] += 1; c['soc_who'][ch].add(id(p)); c['soc_new'] = True; w.stats['soc_tok_player'] += 1


def mod(c, ch, ideo):
    cl = CLS[ch]; m = 0
    if c['dom'] == cl: m += 1
    if c['ali'] == cl: m -= 1
    if ch in ('Труд', 'Гласность'): m += 1 if ideo in DEM else -1 if ideo in DICT else 0
    if ch == 'Порядок' and ideo == 'Полицейское государство': m += 1
    if ch == 'Тень' and ideo in ('Клептократия', 'Вольница'): m += 1
    return m


def world(w):
    if not SOC: return
    st = w.stats
    if BGMODE == 'crisis':                                    # фон: недовольство без кризиса
        for c in w.countries:
            r = d6() + d6() + d6()
            if 5 + c['stab'] <= r < 8 + c['stab']: c['soc'][CH[c['ali']]] += 1; c['soc_new'] = True; st['soc_tok_bg'] += 1
    elif d6() <= BG:                                          # фон
        c = random.choice(w.countries); r = d6()
        cl = c['ali'] if r <= 3 else c['dom'] if r <= 5 else random.choice(list(CH))
        c['soc'][CH[cl]] += 1; st['soc_tok_bg'] += 1
    for c in w.countries:
        c['pol'] = [x for x in c['pol'] if x[2] > w.wt]
        for ch, k in list(c['soc'].items()):
            if k < PORE: continue
            who = c['soc_who'][ch]; r = d6() + mod(c, ch, c['ideo'])
            kind = 'подавление' if r <= SUPP else 'имитация' if r <= 4 else 'уступка'
            st['soc_' + kind] += 1; st['soc_' + kind + '_' + ch] += 1
            if who: st['soc_res_with_player'] += 1
            if kind == 'уступка':
                c['pol'].append((CLS[ch], 1, w.wt + LEN, ch, kind, frozenset(who)))
                if WIDE:                                      # платят все остальные жители страны: −1 возм. сразу
                    for p in w.players:
                        if p is not None and p.alive and w.country(p) is c and p.cls != CLS[ch]:
                            p.vozm -= 1; st['soc_pay'] += 1
                            if id(p) not in who: st['soc_pay_by_other'] += 1
                else: c['pol'].append((PAYER[ch], -1, w.wt + LEN, ch, kind, frozenset(who)))
            elif kind == 'подавление':
                c['pol'].append((CLS[ch], -1, w.wt + LEN, ch, kind, frozenset(who))); c['stab'] -= 1
                for p in w.players:
                    if p is not None and id(p) in who and p.alive and d6() <= 2: p.add_item('Дурная слава', 'стигма'); st['soc_stigma'] += 1
            c['soc'][ch] = 0; c['soc_who'][ch] = set()
        new = c.pop('soc_new', False)
        if sum(c['soc'].values()) > 0 and not (DECAY == 'quiet' and new):   # затухание: один жетон
            ch = random.choice([x for x, v in c['soc'].items() if v > 0]); c['soc'][ch] -= 1


def inc_mod(w, p):
    if not SOC: return 0
    c = w.country(p); m = 0
    for cl, v, until, ch, kind, who in c['pol']:
        if cl == p.cls:
            m += v
            if COUNT:
                w.stats['soc_hit' + ('+' if v > 0 else '-')] += 1
                if who and id(p) not in who: w.stats['soc_hit_by_other'] += 1
                if id(p) in who: w.stats['soc_hit_self'] += 1
    return m
