"""Колода смыслов: разбор meanings.md в условия-предикаты и подсчёт счастья.
Каждое условие → функция f(p) -> bool по состоянию персонажа и журналу жизни p.log.
Условия, которые симуляция не моделирует (эмиграция, розыгрыш козырей и т. п.), помечены UNREACH и всегда ложны;
«Никогда не эмигрировать» и подобные — всегда истинны (эмиграции в модели нет)."""
import re, os, collections as C

ST = ['Сила', 'Выносливость', 'Ловкость', 'Интеллект', 'Мудрость', 'Харизма', 'Смекалка', 'Красота']
CRANK = {'Народ': 0, 'Армия': 1, 'Полиция': 1, 'Интеллигенция': 1, 'Мафия': 2, 'Олигархи': 3}   # по базовому доходу 1/2/2/2/3/4
CLS_RE = r'(Народ|Армия|Полиция|Интеллигенция|Мафия|Олигархи)'
STATUSES = ['Диплом', 'Офицерское звание', 'Партбилет', 'Значок', 'Присяга']

def friends(p): return sum(v for k, v in p.items.items() if k.startswith('Друг') and v > 0)
def partner(p): return p.items.get('Партнёр', 0) > 0
def spouse(p): return p.items.get('Супруг', 0) > 0
def kids(p): return p.items.get('ребёнок', 0)
def stigmas(p): return [k for k, v in p.items.items() if v > 0 and p.itype.get(k) == 'стигма'] + (['Привычка'] if p.habit else [])
def trumps(p): return [k for k, v in p.items.items() if v > 0 and p.itype.get(k) == 'козырь']
def things(p): return [k for k, v in p.items.items() if v > 0 and p.itype.get(k) == 'предмет']
def has(p, nm): return p.items.get(nm, 0) > 0
def pension(p): return 0 if p.stazh < 5 else (3 if p.stazh >= 10 else 2 if p.stazh >= 7 else 1)

UNREACH = 'UNREACH'   # маркер: в модели недостижимо

def num(s): return int(s.replace('−', '-').replace('+', ''))

def build(text, prev=None):
    """Вернуть (функция, флаг). Флаг: 'ok', 'approx' (приближённо) или UNREACH."""
    t = text.strip()
    if t.startswith('Пара: '): t = t[6:]
    # --- третий проход облегчения (шестой прогон) ---
    if t == 'Завести Партнёра': return (lambda p: p.log['partners'] >= 1), 'ok'
    if t == 'Класс Интеллигенция или Диплом в момент смерти': return (lambda p: p.cls == 'Интеллигенция' or has(p, 'Диплом')), 'ok'
    if t == 'Партнёр, Супруг(а) или Друг другой культуры': return (lambda p: p.log['other_cult_partner'] > 0 or has(p, 'Друг из другой культуры')), 'ok'
    if t == '«Имя в спорте» или Сила 6+': return (lambda p: has(p, 'Имя в спорте') or p.st['Сила'] >= 6), 'ok'
    if t == 'Получить козырь или выиграть в казино': return (lambda p: p.log['trump_got'] > 0 or p.log['casino_win'] > 0), 'ok'
    if t == 'Сменить класс или поднять Положение семьи до +1': return (lambda p: p.log['cls_change'] >= 1 or p.pos_ >= 1), 'approx'
    if t == 'Не состоять в браке': return (lambda p: not spouse(p)), 'ok'
    if t == 'Возможности не выше +8 при Интеллекте 7+': return (lambda p: p.vozm <= 8 and p.st['Интеллект'] >= 7), 'ok'
    if t == 'Психическое здоровье +3, а со стигмой «Судимость» — +1': return (lambda p: p.psy >= (1 if has(p, 'Судимость') else 3)), 'ok'
    if t == 'Войти в Зрелость в браке': return (lambda p: 3 in p.entry and p.entry[3]['spouse']), 'ok'
    # --- четвёртый проход (седьмой прогон) ---
    if t == 'Сохранить или завести Друга после эмиграции': return (lambda p: p.log['emig'] > 0 and friends(p) >= 1), 'ok'
    m = re.match(r'Психическое здоровье \+(\d) после эмиграции$', t)
    if m: n = int(m.group(1)); return (lambda p: p.log['emig'] > 0 and p.psy >= n), 'ok'
    if t == 'Положение семьи +1 и выше или Класс выше класса рождения': return (lambda p: p.pos_ >= 1 or CRANK[p.cls] > CRANK[p.cls0]), 'ok'
    if t == 'Класс выше класса рождения, Армия или Полиция': return (lambda p: CRANK[p.cls] > CRANK[p.cls0] or p.cls in ('Армия', 'Полиция')), 'ok'
    if t == 'Стигма «Дурная слава», «Враг» или «Судимость»': return (lambda p: has(p, 'Враг') or has(p, 'Дурная слава') or has(p, 'Судимость')), 'ok'
    if t == 'Любое «Имя» (искусство, наука, спорт) или оказаться на победившей стороне смены власти': return (lambda p: any(k.startswith('Имя') and v > 0 for k, v in p.items.items()) or p.log['name_art'] > 0 or p.log['smuta_win'] > 0), 'ok'
    if t == 'Друг или Супруг(а) рядом после эмиграции': return (lambda p: p.log['emig'] > 0 and (friends(p) >= 1 or spouse(p))), 'ok'
    if t == 'Супруг(а) или Ребёнок': return (lambda p: spouse(p) or kids(p) >= 1), 'ok'
    m = re.match(r'«Имя в спорте» или Сила (\d)\+$', t)
    if m: n = int(m.group(1)); return (lambda p: has(p, 'Имя в спорте') or p.st['Сила'] >= n), 'ok'
    # --- восьмой прогон: проход по сильным и слабым картам ---
    if t == 'Войти в Древность в браке': return (lambda p: 5 in p.entry and p.entry[5]['spouse']), 'ok'
    if t == 'Положение семьи +1 и выше, Класс выше класса рождения или Стаж 10+': return (lambda p: p.pos_ >= 1 or CRANK[p.cls] > CRANK[p.cls0] or p.stazh >= 10), 'ok'
    # --- девятый прогон: микропроход ---
    if t == 'Один Партнёр за всю жизнь, ни одного развода, Супруг(а) рядом в момент смерти': return (lambda p: p.log['partners'] == 1 and p.log['divorce'] == 0 and spouse(p)), 'ok'
    if t == 'Побывать на войне или «Присяга»': return (lambda p: p.log['war'] > 0 or has(p, 'Присяга')), 'ok'
    # --- эмиграция (моделируется с пятого прогона) ---
    if t == 'Никогда не эмигрировать': return (lambda p: p.log['emig'] == 0), 'ok'
    if t == 'Умереть в стране рождения': return (lambda p: p.cidx == p.birth_c), 'ok'
    if t.startswith('Аккультурация не выше шага 1'): return (lambda p: p.acc <= 1), 'ok'
    if t == 'Эмигрировать': return (lambda p: p.log['emig'] > 0), 'ok'
    if t == 'Эмигрировать дважды': return (lambda p: p.log['emig'] >= 2), 'ok'
    m = re.match(r'Аккультурация до шага (\d)$', t)
    if m: n = int(m.group(1)); return (lambda p: p.log['acc_max'] >= n), 'ok'
    if t == 'Психическое здоровье +3 после эмиграции': return (lambda p: p.log['emig'] > 0 and p.psy >= 3), 'ok'
    if t.startswith('Войти в новый отрезок со стигмой «Без документов»'): return (lambda p: p.log['seg_nodocs'] > 0), 'ok'
    if t == 'Обряд своей культуры в новой стране': return (lambda p: p.log['rite_abroad'] > 0), 'ok'
    if t == 'Вернуться в страну рождения': return (lambda p: p.log['returned'] > 0), 'ok'
    if t == 'Возможности +5 после возвращения': return (lambda p: p.log['returned'] > 0 and p.cidx == p.birth_c and p.vozm >= 5), 'ok'
    if t == 'Эмигрировать и вернуться в страну рождения': return (lambda p: p.log['emig'] > 0 and p.log['returned'] > 0), 'ok'
    if t.startswith('Бегство из страны'): return (lambda p: p.log['flight'] > 0), 'ok'
    if t == 'Эмигрировать после побега': return (lambda p: p.log['flight'] > 0), 'ok'
    # --- чего модель не видит: козыри «Верхов» и «Дна», исходы Рынка молодости, побег из тюрьмы ---
    if re.search(r'Побег из тюрьмы|Сыграть козырь|антикозырь «Ва-банк»|Боевые друзья$|Славу и выгорание|«Компромат»|«Контрабандный канал»', t): return None, UNREACH
    if t == 'Ни разу не вернуться туда': return (lambda p: p.log['reentered'] == 0), 'ok'
    # --- контекстные «так» / «это» ---
    if t == 'Сделать это второй раз':
        return (lambda p: p.log['smuta_win'] >= 2), 'ok'
    if t == 'Пережить так вторую смену власти':
        return (lambda p: p.log['pc_keep_class'] >= 2), 'ok'
    # --- характеристики ---
    m = re.match(r'(%s) (\d+)\+?( в Старости)?$' % '|'.join(ST), t)
    if m:
        k, n, old = m.group(1), int(m.group(2)), m.group(3)
        if old: return (lambda p: p.seg >= 4 and p.st[k] >= n), 'ok'
        return (lambda p: p.st[k] >= n), 'ok'
    m = re.match(r'(Психическое|Физическое) здоровье ([+−-]?\d+)( и выше)?( в Старости)?$', t)
    if m:
        a = 'psy' if m.group(1) == 'Психическое' else 'phys'; n = num(m.group(2)); old = m.group(4)
        return (lambda p: (p.seg >= 4 or not old) and getattr(p, a) >= n), 'ok'
    m = re.match(r'(Психическое|Физическое) здоровье ([+−-]?\d+)(?: и выше)? при входе в (Старость|Зрелость|Молодость)$', t)
    if m:
        a = 'psy' if m.group(1) == 'Психическое' else 'phys'; n = num(m.group(2)); sg = {'Старость': 4, 'Зрелость': 3, 'Молодость': 2}[m.group(3)]
        return (lambda p: sg in p.entry and p.entry[sg][a] >= n), 'ok'
    if t == 'Психическое здоровье +3 со стигмой «Судимость»': return (lambda p: p.psy >= 3 and has(p, 'Судимость')), 'ok'
    m = re.match(r'Стигма «Враг» при психическом здоровье \+3$', t)
    if m: return (lambda p: p.psy >= 3 and has(p, 'Враг')), 'ok'
    if t.startswith('Стигма «Дурная слава» или «Враг» при психическом'): return (lambda p: p.psy >= 3 and (has(p, 'Враг') or has(p, 'Дурная слава'))), 'ok'
    # --- Возможности ---
    m = re.match(r'Возможности ([+−-]?\d+)( и выше)?( \(без долгов\))?$', t)
    if m: n = num(m.group(1)); return (lambda p: p.vozm >= n), 'ok'
    m = re.match(r'Возможности ([+−-]?\d+) и ниже$', t)
    if m: n = num(m.group(1)); return (lambda p: p.vozm <= n), 'ok'
    m = re.match(r'Возможности ([+−-]?\d+) в Старости$', t)
    if m: n = num(m.group(1)); return (lambda p: p.seg >= 4 and p.vozm >= n), 'ok'
    m = re.match(r'Возможности ([+−-]?\d+) при входе в Старость$', t)
    if m: n = num(m.group(1)); return (lambda p: 4 in p.entry and p.entry[4]['vozm'] >= n), 'ok'
    if t.startswith('Возможности не выше +5 при Интеллекте 8+'): return (lambda p: p.vozm <= 5 and p.st['Интеллект'] >= 8), 'ok'
    m = re.match(r'Умереть с Возможностями ([+−-]?\d+)( и выше)?$', t)
    if m: n = num(m.group(1)); return (lambda p: p.vozm >= n), 'ok'
    if t.startswith('Умереть с Возможностями 0 и ниже'): return (lambda p: p.vozm <= 0), 'ok'
    if t.startswith('Хотя бы раз разориться'): return (lambda p: p.log['broke'] > 0), 'ok'
    # --- Стаж, пенсия ---
    m = re.match(r'Стаж (\d+)\+$', t)
    if m: n = int(m.group(1)); return (lambda p: p.stazh >= n), 'ok'
    if t == 'Стаж 5+ после выхода': return (lambda p: p.log['out_ever'] > 0 and p.stazh - p.log['stazh_at_out'] >= 5), 'ok'
    m = re.match(r'Пенсия \+(\d) и выше$', t)
    if m: n = int(m.group(1)); return (lambda p: p.seg >= 4 and pension(p) >= n), 'ok'
    # --- отрезки ---
    if t == 'Дожить до Старости': return (lambda p: p.maxseg >= 4), 'ok'
    if t == 'Дожить до Древности': return (lambda p: p.maxseg >= 5), 'ok'
    if t == 'Дожить до Старости, не вернувшись в тюрьму': return (lambda p: p.maxseg >= 4 and p.n_prison <= 1), 'ok'
    # --- класс ---
    m = re.match(r'Класс %s( или %s)?( или %s)?$' % (CLS_RE, CLS_RE, CLS_RE), t)
    if m: cs = {x for x in m.groups() if x}; return (lambda p: p.cls in cs), 'ok'
    m = re.match(r'Класс %s, %s или %s$' % (CLS_RE, CLS_RE, CLS_RE), t)
    if m: cs = set(m.groups()); return (lambda p: p.cls in cs), 'ok'
    m = re.match(r'Класс %s( или %s)? в момент смерти$' % (CLS_RE, CLS_RE), t)
    if m: cs = {x for x in m.groups() if x}; return (lambda p: p.cls in cs), 'ok'
    if t == 'Класс выше класса рождения': return (lambda p: CRANK[p.cls] > CRANK[p.cls0]), 'ok'
    if t == 'Класс выше класса рождения или Армия': return (lambda p: CRANK[p.cls] > CRANK[p.cls0] or p.cls == 'Армия'), 'ok'
    if t == 'Класс не ниже класса рождения в момент смерти': return (lambda p: CRANK[p.cls] >= CRANK[p.cls0]), 'ok'
    if t == 'Ни разу не сменить класс': return (lambda p: p.log['cls_change'] == 0), 'ok'
    if t == 'Сменить класс дважды': return (lambda p: p.log['cls_change'] >= 2), 'ok'
    if t == 'Сменить класс': return (lambda p: p.log['cls_change'] >= 1), 'ok'
    if t in ('Стигма «Враг» или «Дурная слава»', 'Стигма «Дурная слава» или «Враг»'): return (lambda p: has(p, 'Враг') or has(p, 'Дурная слава')), 'ok'
    if t == 'Сменить класс Мафия на любой другой': return (lambda p: p.log['left_mafia'] > 0), 'ok'
    if t == 'Остаться в классе Армия до Старости': return (lambda p: 4 in p.entry and p.entry[4]['cls'] == 'Армия' and p.log['left_army'] == 0), 'ok'
    if t in ('Остаться Олигархом до смерти',): return (lambda p: p.cls == 'Олигархи' and p.log['left_olig'] == 0), 'ok'
    if t == 'Умереть в классе Олигархи': return (lambda p: p.cls == 'Олигархи'), 'ok'
    if t == 'Остаться в классе Олигархи со стигмой «Судимость»': return (lambda p: p.log['olig_sud'] > 0), 'ok'
    if t == 'Отбыть срок и вернуться в класс Мафия': return (lambda p: p.log['prison_out'] > 0 and p.cls == 'Мафия'), 'approx'
    # --- семья ---
    if t == 'Партнёр или Супруг(а)': return (lambda p: partner(p) or spouse(p)), 'ok'
    if t in ('Супруг(а)',): return spouse, 'ok'
    if t == 'Супруг(а) и Ребёнок': return (lambda p: spouse(p) and kids(p) > 0), 'ok'
    if t == 'Супруг(а) в Старости': return (lambda p: p.seg >= 4 and spouse(p)), 'ok'
    if t == 'Супруг(а) рядом в момент смерти': return spouse, 'ok'
    if t == 'Супруг(а) своей культуры': return (lambda p: spouse(p) and p.sp_same_cult), 'ok'
    if t == 'Супруг(а) другой расы': return (lambda p: spouse(p) and not p.sp_same_race), 'ok'
    if t == 'Супруг(а) из Олигархов': return (lambda p: spouse(p) and p.sp_cls == 'Олигархи'), 'ok'
    if t == 'Партнёр или Супруг(а) другой культуры': return (lambda p: p.log['other_cult_partner'] > 0), 'ok'
    if t == 'Партнёр': return (lambda p: p.log['partners'] > 0), 'ok'
    if t == 'Три разных Партнёра за жизнь': return (lambda p: p.log['partners'] >= 3), 'ok'
    if t == 'Один Партнёр за всю жизнь и ни одного развода': return (lambda p: p.log['partners'] == 1 and p.log['divorce'] == 0), 'ok'
    if t == 'Войти в Старость в браке': return (lambda p: 4 in p.entry and p.entry[4]['spouse']), 'ok'
    if t == 'Впервые вступить в брак в Зрелости или позже': return (lambda p: p.log['wed_seg'] >= 3), 'ok'
    if t in ('Ребёнок', 'Ребёнок — наследник'): return (lambda p: kids(p) >= 1), 'ok'
    if t in ('Второй ребёнок', 'Второй ребёнок или воспитанник'): return (lambda p: kids(p) >= 2), 'ok'
    if t == 'Третий ребёнок': return (lambda p: kids(p) >= 3), 'ok'
    if t == 'Воспитанник-ученик': return (lambda p: p.log['pupil'] > 0), 'approx'
    if re.match(r'Ребёнок или воспитанник', t): return (lambda p: kids(p) >= 1), 'ok'
    m = re.match(r'(Семейная поддержка|Сплочённость семьи) \+(\d)( и выше)?( в момент смерти)?$', t)
    if m: n = int(m.group(2)); return (lambda p: p.coh >= n), 'ok'
    if t.startswith('Есть на кого опереться'): return (lambda p: p.coh >= 1 or friends(p) >= 1), 'ok'
    # --- люди ---
    if t in ('Друг', 'Друг рядом в момент смерти'): return (lambda p: friends(p) >= 1), 'ok'
    if t == 'Два Друга': return (lambda p: friends(p) >= 2), 'ok'
    if t == 'Друг другой культуры': return (lambda p: has(p, 'Друг из другой культуры')), 'ok'
    if t == 'Нет Партнёра и Друга': return (lambda p: not partner(p) and not spouse(p) and friends(p) == 0), 'ok'
    m = re.match(r'Связь «([^»]+)»$', t)
    if m: nm = m.group(1); return (lambda p: has(p, nm)), 'ok'
    # --- статусы, козыри, вещи ---
    if t == 'Диплом': return (lambda p: has(p, 'Диплом')), 'ok'
    if t == 'Престижный диплом': return (lambda p: has(p, 'Диплом') and p.log['prestige'] > 0), 'approx'
    if t in ('«Значок»', 'Присяга', '«Партбилет»', '«Офицерское звание»', 'Звание', 'Статус «Присяга» в момент смерти', '«Значок» в момент смерти'):
        nm = {'«Значок»': 'Значок', 'Присяга': 'Присяга', '«Партбилет»': 'Партбилет', '«Офицерское звание»': 'Офицерское звание', 'Звание': 'Офицерское звание',
              'Статус «Присяга» в момент смерти': 'Присяга', '«Значок» в момент смерти': 'Значок'}[t]
        return (lambda p: has(p, nm)), 'ok'
    m = re.match(r'Предмет «([^»]+)»$', t)
    if m: nm = m.group(1); return (lambda p: has(p, nm)), 'ok'
    if t.startswith('Любой из статусов'): return (lambda p: any(has(p, x) for x in ('Значок', 'Офицерское звание', 'Партбилет'))), 'ok'
    if t.startswith('Два статуса одновременно'): return (lambda p: sum(has(p, x) for x in STATUSES) >= 2), 'ok'
    if t == 'Два козыря одновременно': return (lambda p: len(trumps(p)) >= 2), 'ok'
    if t == 'Получить козырь': return (lambda p: p.log['trump_got'] > 0), 'ok'
    if t == '«Имя в спорте» или Сила 7+': return (lambda p: has(p, 'Имя в спорте') or p.st['Сила'] >= 7), 'ok'
    if t == 'Класс выше класса рождения или Положение семьи +1 и выше': return (lambda p: CRANK[p.cls] > CRANK[p.cls0] or p.pos_ >= 1), 'ok'
    m = re.match(r'Положение семьи ([+−-]?\d+) и выше$', t)
    if m: n = num(m.group(1)); return (lambda p: p.pos_ >= n), 'ok'
    if t == 'Друг в новой стране': return (lambda p: friends(p) >= 1 and p.cidx != p.birth_c), 'ok'
    m = re.match(r'Связи (\d)\+$', t)
    if m: n = int(m.group(1)); return (lambda p: sum(v for k, v in p.items.items() if v > 0 and p.itype.get(k) == 'связь') >= n), 'ok'
    if t == 'Партнёр или Супруг(а) другой расы или культуры': return (lambda p: p.log['other_cult_partner'] > 0 or p.log['other_race_partner'] > 0), 'ok'
    if t.startswith('Любое «Имя»'): return (lambda p: any(k.startswith('Имя') and v > 0 for k, v in p.items.items()) or p.log['name_art'] > 0), 'ok'
    if t.startswith('Выиграть в казино или сыграть антикозырь'): return (lambda p: p.log['casino_win'] > 0), 'ok'
    if t.startswith('Связь «Покровитель» или «Человек из кабинета»'): return (lambda p: has(p, 'Покровитель') or has(p, 'Человек из кабинета')), 'ok'
    if t.startswith('«Боевые друзья» или Друг'): return (lambda p: friends(p) >= 1), 'ok'
    if t == 'Две вещи в имуществе': return (lambda p: len(things(p)) >= 2), 'ok'
    if t.startswith('Ни разу не получить «Партбилет»'): return (lambda p: p.log['party_items'] == 0), 'ok'
    # --- стигмы ---
    if t in ('Нет стигм', 'Нет стигм в момент смерти'): return (lambda p: not stigmas(p)), 'ok'
    m = re.match(r'Нет стигмы «([^»]+)»( в момент смерти)?$', t)
    if m: nm = m.group(1); return (lambda p: not has(p, nm)), 'ok'
    if t in ('Нет «Привычки»', 'Нет отметки «Привычка»'): return (lambda p: not p.habit), 'ok'
    if t == 'Ни одной стигмы за всю жизнь': return (lambda p: p.log['stigma_got'] == 0 and p.log['habit_got'] == 0), 'ok'
    if t == 'Избавиться от стигмы': return (lambda p: p.log['stigma_off'] > 0), 'ok'
    if t.startswith('Свобода: нет активной'): return (lambda p: not p.habit and p.inst != 'Тюрьма'), 'ok'
    # --- институты ---
    if t == 'Отбыть срок в тюрьме': return (lambda p: p.log['prison_out'] > 0), 'ok'
    if t == 'Выйти из тюрьмы, психбольницы или кабалы': return (lambda p: p.log['out_ever'] > 0), 'ok'
    if t == 'Ни разу не попасть в тюрьму': return (lambda p: p.n_prison == 0), 'ok'
    if t == 'Ни разу не попасть в психбольницу': return (lambda p: p.log['ward'] == 0), 'ok'
    if t == 'Ни разу не попасть в кабалу': return (lambda p: p.log['kabala'] == 0), 'ok'
    if t == 'Ни разу не попасть в тюрьму, психбольницу или кабалу': return (lambda p: p.n_prison == 0 and p.log['ward'] == 0 and p.log['kabala'] == 0), 'ok'
    if t == 'Ни разу не взять микрозайм': return (lambda p: p.log['micro'] == 0), 'ok'
    # --- рынок и обряды ---
    for k, key in (('Побывать в баре', 'mk_Бар'), ('Побывать в казино', 'mk_Казино'), ('Побывать в борделе', 'mk_Бордель'), ('Выиграть в казино', 'casino_win'),
                   ('Хобби', 'mk_Хобби'), ('Обряд своей культуры', 'mk_Обряд'), ('Сделать пожертвование в храме', 'mk_Храм'), ('Отдать вещь через Заповедник', 'mk_Заповедник')):
        if t == k: return (lambda p, key=key: p.log[key] > 0), 'ok'
    m = re.match(r'(Хобби|Храм|Курсы) в трёх разных отрезках$', t)
    if m: key = {'Хобби': 'Хобби', 'Храм': 'Храм', 'Курсы': 'Курсы'}[m.group(1)]; return (lambda p: len(p.segs[key]) >= 3), 'ok'
    if t == 'Поставить самому 4 отметки в Заповеднике': return (lambda p: p.log['mk_Заповедник'] >= 4), 'ok'
    if t == 'Отметки двум разным видам': return (lambda p: p.log['mk_Заповедник'] >= 2), 'approx'
    if t.startswith('Хотя бы раз сделать пожертвование'): return (lambda p: p.donations > 0), 'ok'
    # --- политика и мир ---
    if re.match(r'(Оказаться|Быть) на победившей стороне смены власти', t): return (lambda p: p.log['smuta_win'] > 0), 'ok'
    if t == 'Ни разу не оказаться на проигравшей стороне Смуты': return (lambda p: p.log['smuta_lose'] == 0), 'ok'
    if t == 'Пережить смену власти': return (lambda p: p.log['pc'] > 0), 'ok'
    if t == 'Пережить две смены власти': return (lambda p: p.log['pc'] >= 2), 'ok'
    if t == 'Пережить смену власти, не потеряв класс': return (lambda p: p.log['pc_keep_class'] > 0), 'ok'
    if t == 'Пережить смену власти с Возможностями +5 и выше': return (lambda p: p.log['pc_vozm5'] > 0), 'ok'
    if t == 'Пережить смену власти, сохранив «Присягу»': return (lambda p: p.log['pc_keep_Присяга'] > 0), 'ok'
    if t == 'Пережить смену власти, сохранив «Значок»': return (lambda p: p.log['pc_keep_Значок'] > 0), 'ok'
    if t.startswith('Пережить смену власти или глобальное'): return (lambda p: p.log['pc'] > 0 or p.log['global'] > 0), 'ok'
    if t == 'Побывать на войне': return (lambda p: p.log['war'] > 0), 'ok'
    # --- выборы в событиях ---
    if t.startswith('«Стук ночью»'): return (lambda p: p.log['hide_neighbor'] > 0), 'ok'
    if t.startswith('Выбрать «сказать»'): return (lambda p: p.log['say_reveal'] > 0), 'ok'
    return None, 'unknown'

def parse(path=os.path.join(os.path.dirname(__file__), 'meanings.md')):
    lines = open(path).read().split('\n')
    cards = []; cur = None; sec = None
    for ln in lines:
        if ln.startswith('## '):
            sec = {'Серость': 'grey', 'Случайные смыслы': 'random', 'Смыслы династий': 'dyn'}.get(ln[3:].strip(), sec)
            if sec == 'grey':
                cur = dict(id='С', name='Серость', deck='grey', kind='Серость', req='', tags=[], conds=[]); cards.append(cur)
            continue
        if sec == 'grey' and ln.startswith('| ') and re.match(r'\| \d+ \|', ln):
            cells = [x.strip() for x in ln.strip('|').split('|')]
            t1 = cells[1].endswith(' — 1 очко'); cur['conds'].append([1.0 if t1 else 0.5, cells[1][:-len(' — 1 очко')] if t1 else cells[1], cells[2]])
            continue
        m = re.match(r'### (Д?\d+)\. (.+)', ln)
        if m:
            cur = dict(id=m.group(1), name=m.group(2).strip(), deck=sec, kind=None, req='', tags=[], conds=[]); cards.append(cur); continue
        if cur is None or sec == 'grey': continue
        m = re.match(r'(Простой|Средний|Сложный) \(', ln)
        if m and cur['kind'] is None:
            cur['kind'] = m.group(1)
            r = re.search(r'требование: ([^·]+)·', ln)
            if r: cur['req'] = r.group(1).strip()
            cur['tags'] = re.findall(r'#(\w+)', ln.split('—')[0])
            continue
        m = re.match(r'- (?:(3|1): )?(.+?) \((сост\.|соб\.|итог)\)\s*$', ln)
        if m:
            pts = int(m.group(1)) if m.group(1) else (1 if cur['kind'] == 'Простой' else 2)
            cur['conds'].append([pts, m.group(2).strip(), m.group(3).rstrip('.')])
    for c in cards:
        prev = None
        for cd in c['conds']:
            f, flag = build(cd[1], prev); cd.append(f); cd.append(flag); prev = cd[1]
        c['reqf'] = req_fn(c['req'])
        c['cap'] = 7 if c['deck'] == 'grey' else 10
        c['unreach_pts'] = sum(cd[0] for cd in c['conds'] if cd[4] == UNREACH)
    return cards

def req_fn(r):
    """Требование карты → функция от семьи персонажа (класс семьи cls0, финансы fin, положение pos_, сплочённость coh0)."""
    if not r: return lambda p: True
    tests = []
    m = re.search(r'класс семьи %s(?: или %s)?' % (CLS_RE, CLS_RE), r)
    if m: tests.append(lambda p, cs={x for x in m.groups() if x}: p.cls0 in cs)
    m = re.search(r'финансы(?: семьи)? ([+−-]\d)( и ниже)?', r)
    if m:
        v = num(m.group(1)); low = bool(m.group(2))
        tests.append((lambda p, v=v: p.fin0 <= v) if low else (lambda p, v=v: p.fin0 >= v))
    m = re.search(r'положение(?: семьи)? \+(\d)', r)
    if m: tests.append(lambda p, v=int(m.group(1)): p.pos0 >= v)
    m = re.search(r'сплочённость(?: семьи)? \+(\d)', r)
    if m: tests.append(lambda p, v=int(m.group(1)): p.coh0 >= v)
    return lambda p: all(f(p) for f in tests)

def score(card, p, detail=False):
    tot = 0.0; got = []
    for pts, txt, typ, f, flag in card['conds']:
        ok = False
        if f is not None:
            try: ok = bool(f(p))
            except Exception: ok = False
        if ok: tot += pts; got.append(txt)
    tot = min(card['cap'], tot)
    return (tot, got) if detail else tot

# ---------- что «хочет» карта: подсказки ИИ ----------
def wants(card):
    w = dict(stats={}, items=set(), cls=set(), flags=set(), vozm=None, psy=None, phys=None)
    for pts, t, typ, f, flag in card['conds']:
        m = re.match(r'(%s) (\d+)' % '|'.join(ST), t)
        if m: w['stats'][m.group(1)] = max(w['stats'].get(m.group(1), 0), int(m.group(2)))
        for x in ('Диплом', 'Значок', 'Присяга', 'Партбилет', 'Офицерское звание', 'Покровитель'):
            if x in t and not t.startswith('Ни разу') and not t.startswith('Нет'): w['items'].add(x)
        if t.startswith('Звание'): w['items'].add('Офицерское звание')
        if re.search(r'Друг', t) and not t.startswith('Нет'): w['flags'].add('friend')
        if re.search(r'Супруг|в браке|брак', t) and not t.startswith('Не '): w['flags'].add('marry')
        if re.search(r'Партнёр', t) and not t.startswith('Нет'): w['flags'].add('partner')
        if re.search(r'Ребёнок|ребёнок|воспитанник', t): w['flags'].add('child')
        if 'Второй ребёнок' in t or 'Третий' in t: w['flags'].add('child2')
        for c in re.findall(CLS_RE, t):
            if not t.startswith('Ни разу') and 'на любой другой' not in t and 'Сменить' not in t: w['cls'].add(c)
        if 'выше класса рождения' in t: w['flags'].add('climb')
        m = re.match(r'(?:Умереть с )?Возможност\w+ ([+−-]?\d+)', t)
        if m and 'ниже' not in t and 'не выше' not in t: w['vozm'] = max(w['vozm'] or -99, num(m.group(1)))
        m = re.match(r'Психическое здоровье ([+−-]?\d+)', t)
        if m: w['psy'] = max(w['psy'] or -99, num(m.group(1)))
        m = re.match(r'Физическое здоровье ([+−-]?\d+)', t)
        if m: w['phys'] = max(w['phys'] or -99, num(m.group(1)))
        if re.search(r'пожертвован|Благотвор', t): w['flags'].add('donate')
        if t.startswith('Хобби'): w['flags'].add('hobby')
        if 'Храм' in t or 'храме' in t: w['flags'].add('temple')
        if 'Курсы' in t: w['flags'].add('courses')
        if 'Обряд' in t: w['flags'].add('rite')
        if 'Заповедник' in t or 'Отметки двум' in t: w['flags'].add('zapoved')
        if re.search(r'баре|казино|борделе', t): w['flags'].add('vice')
        if 'победившей стороне' in t or 'Сделать это второй' in t: w['flags'].add('side')
        if re.search(r'Нет стиг|Ни одной стигмы|Нет стигмы', t): w['flags'].add('clean')
        if re.search(r'Ни разу не попасть в тюрьму|Нет стигмы «Судимость»', t): w['flags'].add('noprison')
        if 'тюрьме' in t and t.startswith('Отбыть'): w['flags'].add('prison')
        if 'Стук ночью' in t: w['flags'].add('hide')
        if 'сказать' in t: w['flags'].add('say')
        if 'Стаж' in t: w['flags'].add('stazh')
        if re.search(r'^Эмигрировать|Аккультурация до шага|после эмиграции|в новой стране|Без документов|^Бегство из страны', t): w['flags'].add('emig')
        if 'дважды' in t and 'Эмигрир' in t: w['flags'].add('twice')
        if re.search(r'Вернуться в страну рождения|после возвращения|и вернуться в страну', t): w['flags'].add('return')
        if 'Без документов' in t: w['flags'].add('illegal')
        if t.startswith('Бегство из страны') or 'после побега' in t: w['flags'].add('flight')
        if re.search(r'Никогда не эмигрировать|Умереть в стране рождения|Аккультурация не выше', t): w['flags'].add('stay')
    return w

if __name__ == '__main__':
    cards = parse()
    print(len(cards), C.Counter(c['deck'] for c in cards))
    unk = C.Counter(); ur = C.Counter(); ap = C.Counter()
    for c in cards:
        for cd in c['conds']:
            if cd[4] == 'unknown': unk[cd[1]] += 1
            if cd[4] == UNREACH: ur[cd[1]] += 1
            if cd[4] == 'approx': ap[cd[1]] += 1
        exp = {'Простой': 10, 'Средний': 5, 'Сложный': 4, 'Серость': 10}[c['kind']]
        if len(c['conds']) != exp: print('!! число условий', c['id'], c['name'], len(c['conds']))
    print('unknown', sum(unk.values())); [print('  ', k, v) for k, v in unk.most_common()]
    print('UNREACH', sum(ur.values())); [print('  ', k, v) for k, v in ur.most_common()]
    print('approx', sum(ap.values())); [print('  ', k, v) for k, v in ap.most_common()]
    print('карты с недостижимыми очками:')
    for c in cards:
        if c['unreach_pts']: print('  ', c['id'], c['name'], c['unreach_pts'], 'из 10')
    print('требования:'); [print('  ', c['id'], c['name'], '|', c['req']) for c in cards if c['req']]
