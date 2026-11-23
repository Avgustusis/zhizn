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
BONUS = {'small': 1, 'mid': 2, 'big': 3, 'smug': 2, 'rack': 2,
         'farm': 1, 'distill': 2, 'lab': 2, 'clinic': 2, 'pmc': 1, 'slave': 3, 'drugs': 2, 'startup': 1}
NEWBIZ = E('NEWBIZ', '1') == '1'      # 18.11: новые дела по идеологиям
ILL = E('ILL', 'alt')                 # 18.11: принят мягкий вариант                # облава вне «своей» идеологии: user — d10 1–9 (клептократия / Мафия у власти — d6 1–3); alt — d10 1–3 (d6 1)
# где дело законно (None — везде)
LEGAL = {'distill': lambda i: i not in ('Теократия', 'Госсоциализм'), 'pmc': lambda i: i not in ('Госсоциализм', 'Военная диктатура'), 'startup': lambda i: i != 'Госсоциализм', 'lab': lambda i: i == 'Технократия', 'clinic': lambda i: i == 'Технократия',
         'slave': lambda i: i == 'Вольница', 'drugs': lambda i: i == 'Вольница'}

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
if NEWBIZ: NEW += [
    dict(_deck='Класс', _sub='Народ', Карта='Земля в аренду', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #община'),
    dict(_deck='Страна', _sub=None, Карта='Винокурня', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #сделка', _need='not:Теократия'),
    dict(_deck='Класс', _sub='Интеллигенция', Карта='Частная лаборатория', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #образование', _need='ideo:Технократия'),
    dict(_deck='Класс', _sub='Интеллигенция', Карта='Клиника радикальной хирургии', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #здоровье', _need='ideo:Технократия'),
    dict(_deck='Класс', _sub='Армия', Карта='Частная военная компания', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #армия', _need='not:Госсоциализм|Военная диктатура'),
    dict(_deck='Класс', _sub='Полиция', Карта='Частная военная компания', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #армия', _need='not:Госсоциализм|Военная диктатура'),
    dict(_deck='Класс', _sub='Мафия', Карта='Невольничий рынок', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #девиация', _need='ideo:Вольница'),
    dict(_deck='Класс', _sub='Мафия', Карта='Подпольная варка', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #девиация', _need='ideo:Вольница' if ILL == 'user' else None),
    dict(_deck='Класс', _sub='Олигархи', Карта='Венчурный инвестор', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #сделка', _need='ideo:Либеральная демократия'),
    dict(_deck='Класс', _sub='Интеллигенция', Карта='Венчурный инвестор', Когда='М З', Тип='Р', Текст='', Теги='#своёдело #сделка', _need='ideo:Либеральная демократия'),
]
HOOK = {c['Карта'] for c in NEW} | {'Точка на рынке', 'Мастерская', 'Кооператив', 'Национализация'}


def legal(w, p, kind=None):
    kind = kind or p.biz['kind']; f = LEGAL.get(kind)
    return f is None or f(w.country(p)['ideo'])


def eligible(w, c, p):
    n = c.get('_need')
    if not n: return True
    ideo = w.country(p)['ideo']
    if n == 'biz': return p.biz is not None
    if n == 'stazh5': return p.stazh >= 5
    if n == 'not_gs': return ideo != 'Госсоциализм'
    if n.startswith('ideo:'): return ideo in n[5:].split('|')
    if n.startswith('not:'): return ideo not in n[4:].split('|')
    return True


def ideo_mod(w, p):
    ideo = w.country(p)['ideo']
    if ideo == 'Либеральная демократия': return 1
    if ideo == 'Социал-демократия': return -2 if p.biz and p.biz['kind'] == 'big' else -1   # 18.11: прогрессивный налог
    if ideo == 'Клептократия': return 1 if p.items.get('Человек из кабинета', 0) > 0 else -1
    if ideo == 'Вольница': return 1
    if ideo == 'Теократия' and E('TAX18', '1') == '1': return -1   # 18.11: десятина
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
    if c['ideo'] in ('Полицейское государство', 'Вольница'): thr = 2
    if p.biz['kind'] == 'startup': thr = max(thr, 2)
    return thr


def seg_enter(w, p, seg):
    if p.biz is None: return
    if seg in (3, 4):
        r = d6()
        if r <= risk_thr(w, p): lose(w, p, 'risk')
        elif NEWBIZ and p.biz['kind'] == 'startup' and r >= 5:
            p.biz.update(kind='mid', bonus=2 if r == 5 else 3); p.bz['grew'] += 1; w.stats['biz_startup_grew'] += 1
        elif r == 6 and p.biz['kind'] == 'farm' and p.biz['bonus'] == 1:
            p.biz.update(bonus=2); p.bz['grew'] += 1; w.stats['biz_grew'] += 1
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
    if NEWBIZ and raid_check(w, p): return True
    inc = income(w, p)
    if NEWBIZ: inc = special(w, p, inc)
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
    if nm in NEWCARDS: return NEWCARDS[nm](w, p, c, ideo, v, want)
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


def _get(w, p, kind, name, cost, need_v, prob, stat=None, thr=0, ok=True):
    if not ok: return True
    want = p.biz is None or p.biz['bonus'] < BONUS[kind]
    if want and p.vozm >= need_v and takes(p, prob):
        p.vozm -= cost
        if stat is None or chk(p, stat, thr): give(w, p, name, kind)
        else: p.psy -= 1
    return True


NEWCARDS = {
    'Земля в аренду': lambda w, p, c, i, v, wn: _get(w, p, 'farm', 'Фермерское хозяйство', 2, 3, 0.6, 'Выносливость', 12),
    'Винокурня': lambda w, p, c, i, v, wn: _get(w, p, 'distill', 'Винокурня', 4, 6, 0.6, 'Смекалка', 12),
    'Частная лаборатория': lambda w, p, c, i, v, wn: _get(w, p, 'lab', 'Частная лаборатория', 4, 6, 0.7, 'Интеллект', 15, ok=p.cls in ('Интеллигенция', 'Олигархи')),
    'Клиника радикальной хирургии': lambda w, p, c, i, v, wn: _get(w, p, 'clinic', 'Клиника радикальной хирургии', 5, 7, 0.7, 'Интеллект', 15, ok=p.items.get('Диплом', 0) > 0 or p.cls == 'Олигархи'),
    'Частная военная компания': lambda w, p, c, i, v, wn: _get(w, p, 'pmc', 'ЧВК', 5, 7, 0.7, 'Харизма', 12, ok=p.cls in ('Армия', 'Полиция', 'Олигархи')),
    'Невольничий рынок': lambda w, p, c, i, v, wn: _get(w, p, 'slave', 'Невольничий рынок', 4, 6, 0.4, None, ok=p.cls in ('Мафия', 'Олигархи')),
    'Подпольная варка': lambda w, p, c, i, v, wn: _get(w, p, 'drugs', 'Незаконные препараты', 3, 4, 0.6, 'Смекалка', 12),
    'Венчурный инвестор': lambda w, p, c, i, v, wn: _get(w, p, 'startup', 'Венчурная фирма', 3, 5, 0.6, 'Смекалка', 15),
}


def raid_check(w, p):
    """облава на незаконное дело: True — дело потеряно"""
    if legal(w, p): return False
    c = w.country(p)
    soft = c['ideo'] == 'Клептократия' or c['dom'] == 'Мафия'
    if ILL == 'user': hit = (d6() <= 3) if soft else (random.randint(1, 10) <= 9)
    else: hit = (d6() <= 1) if soft else (random.randint(1, 10) <= 3)
    if not hit: return False
    w.stats['biz_raid'] += 1; w.stats['biz_raid_' + p.biz['kind']] += 1; p.bz['lost'] += 1
    p.add_item('Судимость', 'стигма'); p.biz = None; p.enter('Тюрьма', random.randint(1, 3))
    return True


def special(w, p, inc):
    """доход и побочные эффекты новых дел за ход «Дела»"""
    k = p.biz['kind']; c = w.country(p)
    if k == 'pmc' and (c.get('war') or (getattr(w, 'front', None) is not None and w.front.kind == 'world')):
        inc += 2; w.stats['biz_pmc_war'] += 1
        if d6() == 1: p.vozm -= 2; p.psy -= 1
    if k == 'lab':
        r = d6()
        if r == 6: p.st['Интеллект'] = min(10, p.st['Интеллект'] + 1)
        elif r == 1: p.add_item('Дурная слава', 'стигма')
    if k == 'clinic' and p.phys < 3 and not p.bz.get('clinic_seg') == p.seg:
        p.phys = min(10, p.phys + 4); p.bz['clinic_seg'] = p.seg; w.stats['biz_clinic_self'] += 1
    if k == 'slave': p.psy -= 1
    if k == 'drugs' and d6() == 1: p.psy -= 1
    return inc


# ---------- «Контора» на поле «Город» (18.11): открыть дело действием ■ вместо Работы ----------
KONT = E('KONT', '1') == '1'
KONT_P = float(E('KONT_P', '0.2'))     # склонность ИИ открыть дело, когда может
KONT_ADD = int(E('KONT_ADD', '2'))     # надбавка к цене в Конторе (карта события — дешевле)
KONT_STAZH = int(E('KONT_STAZH', '0')) # нужен Стаж не меньше
KONT_ONCE = E('KONT_ONCE', '1') == '1' # одна попытка за отрезок
# вид, имя, цена, проверка (характеристика, порог), кто может, где можно открыть
KMENU = [
    ('big', 'Крупное предприятие', 10, ('Смекалка', 18), lambda p: p.cls == 'Олигархи', lambda i: i != 'Госсоциализм'),
    ('slave', 'Невольничий рынок', 8, None, lambda p: p.cls in ('Мафия', 'Олигархи'), lambda i: i == 'Вольница'),
    ('clinic', 'Клиника радикальной хирургии', 7, ('Интеллект', 15), lambda p: p.items.get('Диплом', 0) > 0, lambda i: i == 'Технократия'),
    ('lab', 'Частная лаборатория', 6, ('Интеллект', 15), lambda p: p.cls in ('Интеллигенция', 'Олигархи'), lambda i: i == 'Технократия'),
    ('pmc', 'ЧВК', 7, ('Харизма', 12), lambda p: p.cls in ('Армия', 'Полиция', 'Олигархи'), lambda i: i not in ('Госсоциализм', 'Военная диктатура')),
    ('drugs', 'Незаконные препараты', 4, ('Смекалка', 12), lambda p: p.cls == 'Мафия', lambda i: i == 'Вольница'),
    ('distill', 'Винокурня', 6, ('Смекалка', 15), lambda p: True, lambda i: i not in ('Теократия', 'Госсоциализм')),
    ('mid', 'Мастерская', 6, ('Смекалка', 15), lambda p: True, lambda i: i != 'Госсоциализм'),
    ('mid', 'Кооператив', 6, ('Смекалка', 15), lambda p: True, lambda i: i == 'Госсоциализм'),
    ('startup', 'Венчурная фирма', 4, ('Смекалка', 15), lambda p: p.cls in ('Олигархи', 'Интеллигенция'), lambda i: i == 'Либеральная демократия'),
    ('farm', 'Фермерское хозяйство', 3, ('Выносливость', 12), lambda p: True, lambda i: True),
    ('small', 'Точка на рынке', 3, ('Смекалка', 12), lambda p: True, lambda i: True),
]


def kont_cost(w, p, cost):
    c = w.country(p); i = c['ideo']
    if i == 'Либеральная демократия': cost -= 1                         # регистрация за день
    if i == 'Вольница': cost -= 1                                       # регистрировать не у кого
    if i == 'Клептократия' and not p.items.get('Человек из кабинета', 0): cost += 2   # откат
    return max(1, cost)


def kont_thr(w, p, thr):
    i = w.country(p)['ideo']
    if i == 'Полицейское государство': thr += 3                         # справки и проверки
    if i == 'Вольница': thr -= 3
    if i == 'Национализм' and p.minority: thr += 3
    return thr


def kontora(w, p):
    """Действие «Контора» вместо Работы: True — ход потрачен на открытие дела."""
    if not (KONT and BIZ) or p.biz is not None or p.seg not in (2, 3, 4): return False
    if p.stazh < KONT_STAZH or (KONT_ONCE and p.bz['kont_seg'] == p.seg + 1): return False
    ideo = w.country(p)['ideo']
    if E('KONT_GATE', '1') == '1':
        if w.banned_kont(p): return False
    gate_checked = False
    for kind, name, cost, chk_, who, where in KMENU:
        if not (who(p) and where(ideo)): continue
        cost = kont_cost(w, p, cost + KONT_ADD)
        if p.vozm < cost + 3: continue
        if random.random() >= KONT_P: return False
        if E('KONT_GATE', '1') == '1':
            g = w.try_(p, 'Контора')
            if g is None: return False
            if g is False: p.bz['kont_seg'] = p.seg + 1; return True      # дошёл до двери и раздумал
        p.vozm -= cost; w.stats['kont_try'] += 1; p.bz['kont_seg'] = p.seg + 1
        if chk_ is None or chk(p, chk_[0], kont_thr(w, p, chk_[1])):
            give(w, p, name, kind); w.stats['kont_open'] += 1; w.stats['kont_' + kind] += 1
        else:
            p.vozm += cost // 2; p.psy -= 1; w.stats['kont_fail'] += 1
        return True
    return False
