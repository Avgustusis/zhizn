"""Текст событий фронта из war_data: тот же язык, что на картах «Жизни»."""
import war_data as W

MINUS = '−'
def num(n): return ('+%d' % n) if n > 0 else (MINUS + str(-n))

ROMAN = 'АБВГ'

def cond_text(c):
    k = c[0]
    if k == 'char': return c[1]
    if k == 'char!':
        return {'Аппетит': 'сильный Аппетит', 'Самолюбие': 'сильное Самолюбие'}.get(c[1], 'сильная ' + c[1])
    if k == 'off': return 'офицер'
    if k == 'ideo': return ', '.join(x.lower() if x != 'Госсоциализм' else 'госсоциализм' for x in c[1])
    if k == 'pos': return c[1].capitalize()
    if k == 'item': return 'есть «%s»' % c[1]
    if k == 'tac': return {'атака': 'шёл «В атаку»', 'беречь': '«Беречь себя»'}[c[1]]
    if k == 'mate': return 'есть Супруг(а) или Партнёр'
    if k == 'cls': return 'класс ' + c[1]
    raise ValueError(c)

def atom(a):
    k = a[0]
    if k == 'ph': return '%s физ.' % num(a[1])
    if k == 'ps': return '%s псих.' % num(a[1])
    if k == 'v': return '%s возм.' % num(a[1])
    if k == 'st': return '%s %s до 7' % (num(a[2]), a[1]) if a[2] > 0 else '%s %s' % (num(a[2]), a[1])
    if k == 'ch': return 'характер на шаг к %s' % a[1]
    if k == 'trump': return 'козырь «%s»' % a[1]
    if k == 'link': return 'связь «%s»' % a[1]
    if k == 'stig': return 'стигма «%s»' % a[1]
    if k == 'jr': return 'отметка «%s»' % a[1]
    if k == 'award': return 'награда'
    if k == 'front': return 'фронт %s' % num(a[1])
    if k == 'coh': return 'Сплочённость %s' % num(a[1])
    if k == 'leave': return 'отпуск по ранению'
    if k == 'captive': return 'плен'
    if k == 'prison': return 'трибунал: тюрьма' + (' (тяжёлое)' if a[1] == 'тяжёлое' else '')
    if k == 'rank_lost': return '«Офицерское звание» теряется'
    if k == 'nothing': return 'ничего'
    if k == 'note': return a[1]
    raise ValueError(a)

def join(bits, sep):
    """Склейка без «физ..»: после точки или двоеточия ставим пробел."""
    out = ''
    for b in bits:
        if not out: out = b; continue
        if sep.startswith('.') and out.endswith('.'): out += ' ' + b
        elif out.endswith(':'): out += ' ' + b
        else: out += sep + b
    return out

def seq(parts, inner=False):
    """Части подряд: атомы через запятую; сложные части — через «; » (внутри проверки — через запятую)."""
    out, buf = [], []
    had_atoms = False
    for p in parts:
        if p[0] in ('chk', 'd6', 'opt', 'ifs'):
            if buf: out.append(join(buf, ', ')); buf = []
            out.append(struct(p, add=had_atoms))
        else:
            buf.append(atom(p)); had_atoms = True
    if buf: out.append(join(buf, ', '))
    return join(out, ', ' if inner else '; ')

def plus(parts):
    """Добавка к общему эффекту помечается словом «ещё»."""
    t = seq(parts, inner=True)
    return 'ещё ' + t if t[:1] in '+−' else t

def struct(p, add=False):
    k = p[0]
    if k == 'chk':
        _, stat, t, s_, f = p
        return '🎲 %s %d: успех — %s; провал — %s' % (stat, t, seq(s_, inner=True), seq(f, inner=True))
    if k == 'd6':
        bits = []
        for (a, b), parts in p[1]:
            rng = str(a) if a == b else '%d–%d' % (a, b)
            t = seq(parts, inner=True)
            if add and parts[0][0] in ('ph', 'ps', 'v'): t = 'ещё ' + t
            elif add and parts[0][0] == 'note' and len(parts) > 1 and parts[1][0] in ('ph', 'ps', 'v') and parts[0][1] in ('тиф:',):
                t = t.replace(parts[0][1] + ' ', parts[0][1] + ' ещё ', 1)
            bits.append('d6 %s — %s' % (rng, t))
        return '; '.join(bits)
    if k == 'opt':
        bits = []
        for i, (label, gates, parts) in enumerate(p[1]):
            g = (' (%s)' % ' или '.join(gates)) if gates else ''
            bits.append('%s) %s%s: %s' % (ROMAN[i], label, g, seq(parts, inner=True)))
        return join(bits, '. ')
    if k == 'ifs':
        repl = bool(p[2])
        bits = ['%s: %s' % (cond_text(c), (seq(parts, inner=True) if (repl or not add) else plus(parts))) for c, parts in p[1]]
        if repl:
            first = p[1][0][0][0]
            bits.append(('Остальные: ' if first in ('char', 'char!', 'cls') else 'Иначе: ') + seq(p[2], inner=True))
        return join(bits, '. ')
    raise ValueError(p)

def text(parts):
    s = seq(parts)
    s = s[0].upper() + s[1:] if s and s[0].islower() and not s.startswith('d6') else s
    return s

def event_text(e):
    body = text(e['body'])
    if e['off']:
        body = join([body, 'Офицер: ' + seq(e['off'])], '. ')
    return body

def tags(e): return ' '.join('#' + t for t in e['tags'])

def table_md(cell):
    rows = ['| d10 | Событие | Текст | Эффект | Теги |', '| --- | --- | --- | --- | --- |']
    for i, e in enumerate([e for e in W.EV if e['cell'] == cell]):
        rows.append('| %d | %s | %s | %s | %s |' % (i + 1, e['title'], e['flavor'], event_text(e), tags(e)))
    return '\n'.join(rows)

if __name__ == '__main__':
    for c in range(7, -7, -1):
        print('\n### %+d %s\n' % (c, W.NAME[c]) if c else '\n### 0 %s\n' % W.NAME[c])
        print(table_md(c))
