"""Приближённый разбор текста карт «Жизни» в действия. Не идеален: неизвестные условия — 50/50."""
import re, random

ST = ['Сила', 'Выносливость', 'Ловкость', 'Интеллект', 'Мудрость', 'Харизма', 'Смекалка', 'Красота']
STR = '|'.join(ST)
CLASSES = ['Народ', 'Армия', 'Полиция', 'Интеллигенция', 'Мафия', 'Олигархи']
CLFORM = {'Народ': 'Народ', 'Армия': 'Армия', 'Армию': 'Армия', 'Армией': 'Армия', 'Полиция': 'Полиция', 'Полицию': 'Полиция', 'Полицией': 'Полиция',
          'Интеллигенция': 'Интеллигенция', 'Интеллигенцию': 'Интеллигенция', 'Интеллигенцией': 'Интеллигенция', 'Мафия': 'Мафия', 'Мафию': 'Мафия', 'Мафией': 'Мафия',
          'Олигархи': 'Олигархи', 'Олигархов': 'Олигархи', 'Олигархами': 'Олигархи', 'Народом': 'Народ'}
DICT = ['диктатур', 'военной диктатур', 'госсоциализм', 'теократи']
IDEO_KW = {'либеральн': 'Либ', 'демократи': 'Дем', 'социал-демократ': 'Соц', 'теократи': 'Теокр', 'национализм': 'Нац', 'госсоциализм': 'Госсоц',
           'военн': 'Воен', 'клептократи': 'Клепт', 'диктатур': 'Дикт'}

def d6(): return random.randint(1, 6)

def roll3(adv=0):
    r = [d6() for _ in range(4 if adv else 3)]
    if adv > 0: r.remove(min(r))
    elif adv < 0: r.remove(max(r))
    return sum(r)

POLES = {'коллективизм': (0, -1), 'индивидуализм': (0, 1), 'иерархия': (1, -1), 'равенство': (1, 1), 'патриархат': (2, -1), 'матриархат': (2, 1),
         'порядок': (3, -1), 'риск': (3, 1), 'теизм': (4, -1), 'секуляризм': (4, 1), 'традиция': (5, -1), 'самовыражение': (5, 1),
         'фамилизм': (6, -1), 'институции': (6, 1), 'доверие': (7, -1), 'цинизм': (7, 1), 'честь': (8, -1), 'достоинство': (8, 1),
         'материализм': (9, -1), 'гуманизм': (9, 1), 'этноцентризм': (10, -1), 'открытость': (10, 1)}
CULTS = ['карвенц', 'олейц', 'сард', 'веллийц', 'тамирц', 'хаддр', 'эшвин']
RACES = ['лирен', 'тальв', 'сэйн', 'ванэ', 'кесс', 'орид', 'аэл']

def cond_true(c, p, w):
    """Оценка условия по ключевым словам; неизвестное — 50/50 (и учёт в статистике)."""
    s = c.lower().strip(); pos = w.country(p)['pos']
    if s in ('все', 'всем', 'для всех'): return True
    m = re.search(r'стабильность\s*(\d+)\s*(\+|и\s*ниже|и\s*выше)', s)
    if m:
        v = int(m.group(1)); st = w.country(p)['stab']; return st <= v if 'ниже' in m.group(2) else st >= v
    m = re.search(r'возможности\s*([+−-]?\d+)\+', s)
    if m: return p.vozm >= int(m.group(1).replace('−', '-'))
    m = re.search(r'стаж\s*(\d+)\+', s)
    if m: return p.stazh >= int(m.group(1))
    if s.startswith('нет') and len(s) < 6: return random.random() < 0.5
    if 'смена власти' in s: return w.country(p)['changes'] > 0
    if re.match(r'(при )?войн', s):
        c = w.country(p); return c.get('war', False) or ('диктатур' in s and c['ideo'] == 'Военная диктатура') or ('национал' in s and c['ideo'] == 'Национализм')
    if 'серост' in s: return p.grey
    if s.startswith('нейтрал'):
        ax = getattr(p, '_axis', None); return ax is not None and p.axes[ax] == 0
    for k, (ax, sg) in POLES.items():
        if (k in s or (s.startswith('в культуре') and k[:-1] in s)) and len(s) < 40:
            p._axis = ax; v = p.axes[ax]
            if 'сильно' in s: return v == 2 * sg
            if 'умеренно' in s: return v == sg
            return v * sg > 0
    for i, k in enumerate(CULTS):
        if s.startswith(k): return p.culture.lower().startswith(k)
    for k in RACES:
        if s.startswith(k): return p.race.startswith(k)
    m = re.search(r'есть\s*«([^»]+)»', c)
    if m: return p.items.get(m.group(1), 0) > 0
    if s.startswith('игроки') or s.startswith('страны'): return random.random() < 0.4
    if s.startswith('любой игрок'): return random.random() < 0.15
    if 'ядро и полупериф' in s: return pos in ('ядро', 'полупериферия')
    if 'полупериф' in s: return pos == 'полупериферия'
    if 'ядр' in s: return pos == 'ядро'
    if 'периф' in s: return pos == 'периферия'
    m = re.search(r'финансы семьи\s*([+−-]?\d)\s*и\s*(ниже|выше)', s)
    if m:
        v = int(m.group(1).replace('−', '-')); return p.fin <= v if m.group(2) == 'ниже' else p.fin >= v
    m = re.search(r'сплочённость\s*([+−-]?\d)\s*и\s*(ниже|выше)', s)
    if m:
        v = int(m.group(1).replace('−', '-')); return p.coh <= v if m.group(2) == 'ниже' else p.coh >= v
    m = re.search(r'положение\s*(семьи\s*)?([+−-]?\d)\s*и\s*(ниже|выше)', s)
    if m:
        v = int(m.group(2).replace('−', '-')); return p.pos_ <= v if m.group(3) == 'ниже' else p.pos_ >= v
    m = re.search(r'(%s)\s*(\d+)\+' % STR, c)
    if m: return p.st[m.group(1)] >= int(m.group(2))
    m = re.search(r'возм(?:ожности)?\.?\s*([+−-]?\d+)\s*и\s*(выше|ниже)', s)
    if m:
        v = int(m.group(1).replace('−', '-')); return p.vozm >= v if m.group(2) == 'выше' else p.vozm <= v
    if 'партн' in s or 'супруг' in s: return p.items.get('Партнёр', 0) + p.items.get('Супруг', 0) > 0
    if 'ребён' in s or 'дет' in s and 'есть' in s: return p.items.get('ребёнок', 0) > 0
    if 'женщин' in s: return p.female
    if 'мужчин' in s: return not p.female
    if 'чужак' in s or 'меньшинств' in s: return p.minority
    if 'большинств' in s: return not p.minority
    for k, v in CLFORM.items():
        if s.startswith(k.lower()) or (' ' + k.lower() in s and len(s) < 40): return p.cls == v
    ideo = w.country(p)['ideo']
    if 'диктатур' in s: return ideo in ('Военная диктатура', 'Госсоциализм', 'Теократия')
    if 'демократи' in s: return ideo in ('Либеральная демократия', 'Социал-демократия')
    for k, v in [('либеральн', 'Либеральная демократия'), ('социал', 'Социал-демократия'), ('теократ', 'Теократия'), ('национал', 'Национализм'),
                 ('госсоц', 'Госсоциализм'), ('военн', 'Военная диктатура'), ('клептокр', 'Клептократия')]:
        if k in s: return ideo == v
    w.stats['cond_unknown'] += 1
    return random.random() < 0.5

def deltas(t):
    d = {}
    for m in re.finditer(r'([+−-])\s?(\d+)\s*(физ|псих|возм)', t):
        d[m.group(3)] = d.get(m.group(3), 0) + int(m.group(2)) * (1 if m.group(1) == '+' else -1)
    for m in re.finditer(r'([+−-])\s?(\d+)\s*(?:к\s*)?(%s)' % STR, t):
        d[m.group(3)] = d.get(m.group(3), 0) + int(m.group(2)) * (1 if m.group(1) == '+' else -1)
    for m in re.finditer(r'(Сплочённость|Финансы семьи|Положение семьи)\s*([+−-])\s?(\d)', t):
        d[m.group(1)] = d.get(m.group(1), 0) + int(m.group(3)) * (1 if m.group(2) == '+' else -1)
    return d

def vdel(t):
    d = deltas(t)
    if ITEMV:
        d['_good'] = len(re.findall(r'(?:статус|связь|козырь)\s*«', t))
        d['_bad'] = len(re.findall(r'стигма\s*«', t)) + 2 * len(re.findall(r'тюрьм[аеу]\b', t))
    d['_child'] = len(re.findall(r'«Ребёнок»', t))
    d['_spouse'] = 1 if ('переворачивается в Супруга' in t) else 0
    d['_partner'] = 1 if (re.search(r'(?<!связь )«Партнёр»', t) and not re.search(r'Партн\w*\s*(теряется|уходит)', t)) else 0
    d['_items'] = re.findall(r'(?:статус|связь|козырь|предмет)\s*«([^»]+)»', t)
    m = re.search(r'(?:класс|в класс|переход в класс|станешь|становишься)\s+(Народ\w*|Арми\w+|Полици\w+|Интеллигенци\w+|Мафи\w+|Олигарх\w+)(?!\s*[—:+−-])', t)
    d['_cls'] = CLFORM.get(m.group(1)) if m and 'можно' not in t and 'разреш' not in t else None
    return d

ITEMV = __import__('os').environ.get('ITEMV', '1') == '1'
V_SPOUSE = float(__import__('os').environ.get('V_SPOUSE', '1.0'))
V_CHILD = float(__import__('os').environ.get('V_CHILD', '1.0'))
V_PARTNER = float(__import__('os').environ.get('V_PARTNER', '1.0'))
def value(d, p):
    v = 0; wn = getattr(p, 'wants', None)
    for k, x in d.items():
        if k == 'физ': v += x * (1.6 if p.phys < -2 else 1)
        elif k == 'псих': v += x * (1.6 if p.psy < -2 else 1)
        elif k == 'возм': v += x * (1.3 if p.vozm < 0 else 0.7)
        elif k == '_good': v += x * 2
        elif k == '_bad': v -= x * 3
        elif k == '_child': v += x * (getattr(p, 'v_child', V_CHILD) + (4 if wn and 'child' in wn['flags'] and (p.items.get('ребёнок', 0) == 0 or 'child2' in wn['flags']) else 0))
        elif k == '_spouse': v += x * (getattr(p, 'v_spouse', V_SPOUSE) + (4 if wn and 'marry' in wn['flags'] else 0))
        elif k == '_partner': v += x * (V_PARTNER + (2 if wn and ('partner' in wn['flags'] or 'marry' in wn['flags']) else 0))
        elif k == '_items':
            if wn:
                for nm in x:
                    if nm in wn['items'] and not p.items.get(nm, 0): v += 3
                    if nm.startswith('Друг') and 'friend' in wn['flags']: v += 2
        elif k == '_cls':
            if wn and x:
                if x in wn['cls'] and p.cls not in wn['cls']: v += 4
                elif p.cls in wn['cls'] and x not in wn['cls']: v -= 4
        elif k in ST:
            v += x * 2.5
            if wn and k in wn['stats'] and p.st[k] < wn['stats'][k]: v += x * 2
        elif k == 'Положение семьи': v += x * 1.5
        else: v += x * 2
    if wn:
        if wn['psy'] is not None and p.psy < wn['psy']: v += d.get('псих', 0) * 0.5
        if wn['vozm'] is not None and p.vozm < wn['vozm']: v += d.get('возм', 0) * 0.3
    return v

def exec_text(t, p, w, seg, depth=0):
    """Выполнить текст эффекта; вернуть применённые дельты."""
    if not t or t in ('—', '-'): return {}
    w.stats['texts'] += 1
    # решение А)/Б)
    opts = re.split(r'\s*\b([АБВГ])\)\s*', t)
    if len(opts) >= 4 and depth == 0:
        choices = [opts[i + 1] for i in range(1, len(opts) - 1, 2)]
        best = max(choices, key=lambda c: value(vdel(re.sub(r'провал[^;]*', '', c)), p) + random.uniform(-0.5, 0.5))
        if hasattr(w, 'on_choice'): w.on_choice(p, best)
        return exec_text(best, p, w, seg, depth + 1)
    # проверка
    m = re.search(r'🎲\s*((?:(?:%s)(?:,\s*|\s+или\s+)?)+)\s*(\d+)(\s*\([^)]*\))?:?' % STR, t)
    if m:
        stats = re.findall(STR, m.group(1)); diff = int(m.group(2))
        mod = p.privilege_mod(t); auto = False
        if m.group(3):
            for piece in re.split(r'[;,]\s*', m.group(3).strip('() ')):
                piece = piece.strip()
                if not piece: continue
                if 'автоуспех' in piece:
                    cnd = re.split(r'\s*—\s*', piece)[0]
                    if cond_true(cnd, p, w): auto = True
                    continue
                mm = re.match(r'(.*?)\s*—?\s*([+−-])\s?(\d+)$', piece)
                if mm and mm.group(1).strip():
                    if cond_true(mm.group(1).strip(' —'), p, w): mod += int(mm.group(3)) * (1 if mm.group(2) == '+' else -1)
                    continue
                mm = re.match(r'(.*?)\s*—\s*(\d{2})$', piece)
                if mm and cond_true(mm.group(1), p, w): diff = int(mm.group(2))
        s = max(stats, key=lambda x: p.st[x])
        ok = auto or roll3(1 if s == p.predisp else 0) + p.st[s] + max(-3, min(3, mod)) >= diff
        w.last_fail = not ok
        w.stats['chk_' + s] += 1; w.stats['chk_ok' if ok else 'chk_fail'] += 1
        rest = t[m.end():]
        succ = re.search(r'успех\s*[—-]\s*(.*?)(?=;?\s*провал|$)', rest)
        fail = re.search(r'провал\s*[—-]\s*(.*)', rest)
        pre = t[:m.start()]
        d = exec_text(pre, p, w, seg, depth + 1) if pre.strip() and depth < 3 else {}
        if succ or fail:
            br = (succ.group(1) if succ else '') if ok else (fail.group(1) if fail else '')
            d2 = exec_plain(br, p, w, seg)
        else:
            d2 = exec_plain(rest, p, w, seg) if ok else {}
        for k, v in d2.items(): d[k] = d.get(k, 0) + v
        return d
    return exec_plain(t, p, w, seg)

def exec_plain(t, p, w, seg):
    tot = {}
    r6 = d6()
    clauses = re.split(r';\s*|\.\s+(?=[А-ЯЁA-Z0-9d])', t)
    prev_cond = None; choice_done = None
    for c in clauses:
        c = c.strip()
        if not c: continue
        m = re.match(r'(?:d6\s*)?(\d)(?:\s*[–-]\s*(\d))?\s*—\s*(.*)', c)
        from_d6 = False
        if m:
            a = int(m.group(1)); b = int(m.group(2) or a)
            if not (a <= r6 <= b): continue
            c = m.group(3); from_d6 = True
        low = c.lower()
        if from_d6:
            d = deltas(c); p.apply(d, seg, w)
            for k, v in d.items(): tot[k] = tot.get(k, 0) + v
            p.side_effects(c, w); continue
        if low.startswith('иначе'):
            if prev_cond: continue
            c = re.sub(r'^иначе[:,]?\s*', '', c, flags=re.I)
        elif low.startswith('остальн'):
            if prev_cond: continue
            c = re.sub(r'^остальн\w*[:,]?\s*', '', c, flags=re.I)
        else:
            mm = re.match(r'([^:—]{2,70}?)\s*[:—]\s+(.*)', c)
            if mm and mm.group(1)[:1].islower() and not re.match(r'(если|при|в |на |у |есть|нет|ядро|периф)', mm.group(1)) and not re.search(r'[+−-]\s?\d', mm.group(1)):
                if choice_done is None:
                    sib = [re.match(r'([^:—]{2,70}?)\s*[:—]\s+(.*)', x.strip()) for x in clauses]
                    sib = [x for x in sib if x and x.group(1)[:1].islower() and not re.search(r'[+−-]\s?\d', x.group(1)) and not re.match(r'd6|\d', x.group(1))]
                    choice_done = max(sib, key=lambda x: value(vdel(x.group(2)), p) + random.uniform(-0.5, 0.5)).group(1) if sib else mm.group(1)
                    if hasattr(w, 'on_choice'): w.on_choice(p, choice_done)
                    w.stats['choice_inline'] += 1
                if mm.group(1) != choice_done: continue
                c = mm.group(2); mm = None
            if mm and not re.search(r'[+−-]\s?\d', mm.group(1)) and 'стигма' not in mm.group(1) and 'связь' not in mm.group(1):
                ok = cond_true(mm.group(1), p, w); prev_cond = ok
                if not ok: continue
                c = mm.group(2)
            else:
                prev_cond = None
        # d6 после условия («Олигархи: d6 1–2 — класс Народ»)
        m = re.match(r'(?:d6\s*)?(\d)(?:\s*[–-]\s*(\d))?\s*—\s*(.*)', c)
        if m:
            a = int(m.group(1)); b = int(m.group(2) or a)
            if not (a <= r6 <= b): continue
            c = m.group(3)
        # d6 внутри фразы («провал: −6 возм., d6 1–3 — класс Народ»)
        parts = re.split(r'(?:,\s*|\s+)(?=d6\s*\d(?:\s*[–-]\s*\d)?\s*[—:])', c)
        for j, part in enumerate(parts):
            if j > 0:
                mm2 = re.match(r'd6\s*(\d)(?:\s*[–-]\s*(\d))?\s*[—:]\s*(.*)', part)
                if mm2:
                    a = int(mm2.group(1)); b = int(mm2.group(2) or a)
                    if not (a <= r6 <= b): break
                    part = mm2.group(3)
            d = deltas(part)
            p.apply(d, seg, w)
            for k, v in d.items(): tot[k] = tot.get(k, 0) + v
            p.side_effects(part, w)
    return tot
