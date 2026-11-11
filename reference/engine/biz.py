"""Своё дело (ноябрь 2026): дело заменяет Работу.

Карта дела лежит у игрока, пока дело живо (одно дело за раз, без ячейки).
Действие рынка «Дело» вместо Работы: доход Д + бонус дела (+ поправка идеологии),
без износа здоровья и без Стажа. На входе в Зрелость и Старость — бросок риска:
d6 1 (госсоциализм кроме кооператива, меньшинство при национализме — 1–2) — прогорело;
d6 6 — малое дело вырастает до среднего. На входе в Древность дело продаётся: +3 за каждый +1 бонуса.
"""
import os, random
from engine3 import d6, roll3

E = os.environ.get
BIZ = E('BIZ', '1') == '1'
ITT = E('BIZ_ITT', '0') == '1'
STAZH = E('BIZ_STAZH', '1') == '1'   # ходы Дела идут в Стаж (для смыслов и Серости), но не в пенсию   # опыт: при первом предложении дела жизнь случайно попадает в группу «берёт» или «не берёт»
BONUS = {'small': 1, 'mid': 2, 'big': 3, 'smug': 2, 'rack': 2}

# новые карты событий (дописываются в колоды при BIZ)
NEW = [
    dict(_deck='Молодость', _sub=None, Карта='Будка у вокзала', Когда='С', Тип='Р', Текст='', Теги='#своёдело #работа'),
    dict(_deck='Зрелость', _sub=None, Карта='Своя бригада', Когда='Д', Тип='Р', Текст='', Теги='#своёдело #работа', _need='stazh5'),
    dict(_deck='Зрелость', _sub=None, Карта='Конкурент через дорогу', Когда='Д', Тип='П', Текст='', Теги='#своёдело #сделка', _need='biz'),
    dict(_deck='Страна', _sub=None, Карта='Разрешили частные кафе', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #политика', _need='not_gs'),
    dict(_deck='Страна', _sub=None, Карта='Налоговая проверка', Когда='М З С', Тип='Б', Текст='', Теги='#своёдело #закон', _need='biz'),
    dict(_deck='Класс', _sub='Олигархи', Карта='Приватизация завода', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #сделка', _need='not_gs'),
    dict(_deck='Класс', _sub='Мафия', Карта='Товар из ядра', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #девиация'),
    dict(_deck='Класс', _sub='Мафия', Карта='Район без крыши', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #насилие'),
]
HOOK = {c['Карта'] for c in NEW} | {'Точка на рынке', 'Мастерская', 'Кооператив', 'Национализация'}


def eligible(w, c, p):
    n = c.get('_need')
    if not n: return True
    ideo = w.country(p)['ideo']
    if n == 'biz': return p.biz is not None
    if n == 'stazh5': return p.stazh >= 5
    if n == 'not_gs': return ideo != 'Госсоциализм'
    return True


def ideo_mod(w, p):
    ideo = w.country(p)['ideo']
    if ideo == 'Либеральная демократия': return 1
    if ideo == 'Социал-демократия': return -1
    if ideo == 'Клептократия': return 1 if p.items.get('Человек из кабинета', 0) > 0 else -1
    return 0


def income(w, p):
    return max(1, w.income(p) + p.biz['bonus'] + ideo_mod(w, p))


def give(w, p, name, kind):
    if p.biz is not None:   # одно дело за раз: старое продаётся
        p.vozm += 3 * p.biz['bonus']; p.bz['sold_switch'] += 1
    p.biz = dict(name=name, kind=kind, bonus=BONUS[kind]); p.bz['got'] += 1; p.bz['got_' + kind] += 1
    if p.bz['first_seg'] == 0: p.bz['first_seg'] = p.seg
    w.stats['biz_got_' + name] += 1


def lose(w, p, why):
    k = p.biz['kind']; ideo = w.country(p)['ideo']
    w.stats['biz_lost_' + why] += 1; p.bz['lost'] += 1
    if k == 'smug': p.add_item('Судимость', 'стигма')
    elif k == 'rack': p.add_item('Враг', 'стигма')
    else:
        p.psy -= 2
        if ideo == 'Социал-демократия': p.vozm += 2
    p.biz = None


def risk_thr(w, p):
    c = w.country(p); thr = 1
    if c['ideo'] == 'Госсоциализм' and p.biz['name'] != 'Кооператив': thr = 2
    if c['ideo'] == 'Национализм' and p.minority: thr = 2
    return thr


def seg_enter(w, p, seg):
    if p.biz is None: return
    if seg in (3, 4):
        r = d6()
        if r <= risk_thr(w, p): lose(w, p, 'risk')
        elif r == 6 and p.biz['kind'] == 'small':
            p.biz.update(kind='mid', bonus=2); p.bz['grew'] += 1; w.stats['biz_grew'] += 1
    elif seg == 5:
        p.vozm += 3 * p.biz['bonus']; p.bz['sold'] += 1; w.stats['biz_sold'] += 1; p.biz = None


def work(w, p, c):
    """Действие «Дело» вместо Работы. True — ход обработан."""
    if p.biz is None: return False
    k = p.biz['kind']
    if k == 'smug' and c['pos'] == 'ядро':
        p.vozm -= 3; p.biz = None; w.stats['biz_lost_core'] += 1; p.bz['lost'] += 1
        if d6() <= 2: p.add_item('Судимость', 'стигма')
        return False
    inc = income(w, p)
    if p.psy <= -5: inc = (inc + 1) // 2
    r = d6()
    if k == 'smug' and r == 1: inc = 0; w.stats['biz_smug_seized'] += 1
    if k == 'rack' and r == 1: p.add_item('Дурная слава', 'стигма'); w.stats['biz_rack_slava'] += 1
    if STAZH: p.stazh += 1; p.bz['stazh_biz'] += 1
    p.vozm += inc; p.bz['turns'] += 1; p.bz['inc'] += inc; w.stats['mk_Дело'] += 1
    return True


def takes(p, prob):
    if not ITT: return random.random() < prob
    if not p.bz['arm']: p.bz['arm'] = 1 if random.random() < 0.5 else 2
    return p.bz['arm'] == 1


def chk(p, stat, need, adv=0):
    return roll3(adv) + p.st[stat] >= need


def card(w, p, nm, seg):
    """Карты своего дела. True — карта разыграна здесь."""
    c = w.country(p); ideo = c['ideo']; v = p.vozm
    want = p.biz is None or p.biz['bonus'] < 2
    if nm == 'Точка на рынке':
        if want and v >= 5 and takes(p, 0.7):
            p.vozm -= 3
            if chk(p, 'Смекалка', 15): give(w, p, 'Точка на рынке', 'small')
            else: p.psy -= 1
        else: p.vozm += 1
        return True
    if nm == 'Будка у вокзала':
        if want and v >= 4 and takes(p, 0.7):
            p.vozm -= 2
            if chk(p, 'Ловкость', 12): give(w, p, 'Ремонт обуви', 'small')
        return True
    if nm == 'Мастерская':
        if (p.biz is None or p.biz['bonus'] < 2) and v >= 6 and takes(p, 0.7):
            p.vozm -= 4; r = d6()
            if r <= 2: p.psy -= 2
            elif r <= 4: p.vozm += 4
            else: give(w, p, 'Мастерская', 'mid')
        else: p.psy += 1
        return True
    if nm == 'Кооператив':
        if (p.biz is None or p.biz['bonus'] < 2) and v >= 6 and takes(p, 0.7):
            p.vozm -= 4
            if chk(p, 'Смекалка', 15): give(w, p, 'Кооператив', 'mid')
            else: p.psy -= 1
        return True
    if nm == 'Своя бригада':
        if (p.biz is None or p.biz['bonus'] < 2) and takes(p, 0.6):
            if chk(p, 'Харизма', 12): give(w, p, 'Своя бригада', 'mid')
            else: p.psy -= 1
        return True
    if nm == 'Конкурент через дорогу':
        if chk(p, 'Смекалка', 12): p.psy += 1
        else:
            p.vozm -= 2
            if d6() == 1: lose(w, p, 'rival')
        return True
    if nm == 'Разрешили частные кафе':
        cost = 2 if ideo == 'Либеральная демократия' else 4
        if want and v >= cost + 2 and takes(p, 0.7):
            p.vozm -= cost; give(w, p, 'Кафе на углу', 'small')
        return True
    if nm == 'Налоговая проверка':
        if ideo == 'Госсоциализм':
            if d6() <= 2: lose(w, p, 'tax')
        elif ideo == 'Клептократия':
            if not p.items.get('Человек из кабинета', 0): p.vozm -= 3
        elif ideo == 'Либеральная демократия': p.vozm -= 1
        else: p.vozm -= 2
        if p.cls == 'Мафия' and d6() == 1: p.add_item('Судимость', 'стигма')
        return True
    if nm == 'Приватизация завода':
        if (p.biz is None or p.biz['bonus'] < 3) and v >= 8 and takes(p, 0.7):
            auto = ideo == 'Клептократия' or p.items.get('Человек из кабинета', 0) > 0
            if auto or chk(p, 'Смекалка', 15): p.vozm -= 6; give(w, p, 'Крупное предприятие', 'big')
            else: p.vozm -= 3; p.psy -= 1
        return True
    if nm == 'Товар из ядра':
        if c['pos'] == 'ядро':
            p.vozm -= 3
            if d6() <= 2: p.add_item('Судимость', 'стигма')
        elif want and v >= 4 and takes(p, 0.7):
            p.vozm -= 2; give(w, p, 'Серый импорт', 'smug')
        return True
    if nm == 'Район без крыши':
        if want and takes(p, 0.6):
            if d6() == 1: p.add_item('Враг', 'стигма')
            give(w, p, 'Рекет', 'rack')
        return True
    if nm == 'Национализация':
        if ideo != 'Госсоциализм': return True
        if p.cls == 'Олигархи' or p.biz is not None:
            if p.items.get('Офшор', 0) > 0: p.vozm -= 1; p.items['Офшор'] -= 1
            elif chk(p, 'Смекалка', 15): p.vozm -= 1
            else:
                p.vozm -= 5
                if d6() == 1 and p.cls == 'Олигархи': w.stats['nat_to_people'] += 1; p.change_class('Народ', w)
                elif p.biz is not None: lose(w, p, 'nation')
        elif p.cls == 'Народ': p.psy += 1
        return True
    return False
