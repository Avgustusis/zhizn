import { useMemo, useState } from 'react'
import { decks } from './data/index.ts'
import { DECKS, type Card, type DeckId } from './data/schema.ts'
import { renderCond, renderNodes } from './data/render.ts'
import { meanings } from './data/meanings.ts'
import { items } from './data/items.ts'
import type { Item, Meaning } from './data/schema.ts'

const DECK_COLOR: Partial<Record<string, string>> = {
  'возраст': '#B8862F', 'отношения': '#A8322B', 'культура': '#4E6B4A', 'страна': '#2F4A6B', 'развилка': '#5E5470',
  'судьба': '#B39A5B', 'смута': '#6B2A22', 'мир': '#23304A', 'тюрьма': '#5C6670', 'психбольница': '#9DB7A5',
  'кабала': '#7A5A36', 'класс': '#6E6A4E',
}
const KIND: Record<Card['kind'], string> = { 'Б': 'бывает', 'П': 'проверка', 'Р': 'решение' }

function CardView({ card, legend, color }: { card: Card; legend?: Record<string, string>; color: string }) {
  return (
    <article className={'card' + (card.doubts ? ' doubtful' : '')} style={{ borderTopColor: color }}>
      <header>
        <span className="num">{card.cls ? `${card.cls} · ` : ''}№ {card.n}</span>
        <h3>{card.title}{card.miracle && ' ✨'}</h3>
        <span className="kind">{KIND[card.kind]}</span>
      </header>
      {card.text && <p className="text">{card.text}</p>}
      {card.cell && <p className="req">На поле: {card.cell}</p>}
      {card.filter && <p className="req">Фильтр: {card.filter}</p>}
      {card.requires && <p className="req">Только если: {renderCond(card.requires)}</p>}
      {card.cancelBy && <p className="req">Отменяет козырь: {card.cancelBy.map((x) => `«${x}»`).join(', ')}</p>}
      <section>
        <h4>Оригинал</h4>
        <p className="src">{card.src}</p>
      </section>
      {card.target && <p className="req">Целевая страна: {card.target}{card.scope ? ` · охват: ${card.scope}` : ''}</p>}
      {card.country && (
        <section>
          <h4>Разбор: страна</h4>
          <pre className="parsed">{renderNodes(card.country).join('\n')}</pre>
        </section>
      )}
      <section>
        <h4>{card.country || card.target ? 'Разбор: игроки' : card.sides ? 'Разбор: для всех' : 'Разбор'}</h4>
        <pre className="parsed">{renderNodes(card.effect).join('\n')}</pre>
      </section>
      {card.sides && (['win', 'lose', 'neutral'] as const).map((k) => (
        <section key={k}>
          <h4>Разбор: {{ win: 'победители', lose: 'проигравшие', neutral: 'нейтралы' }[k]}</h4>
          <pre className="parsed">{renderNodes(card.sides![k]).join('\n')}</pre>
        </section>
      ))}
      {card.doubts && (
        <section className="doubts">
          <h4>Вопрос к автору</h4>
          {card.doubts.map((d, i) => <p key={i}>{d}</p>)}
        </section>
      )}
      <footer>
        <span className="tags">{card.tags.join(' ') || '—'}</span>
        {card.segs && <span className="sub">{card.segs.length === 6 ? 'все отрезки' : card.segs.map((x) => x.slice(0, 2)).join(' ')}</span>}
        {card.sub && <span className="sub" title={card.sub.map((s) => legend?.[s] ?? s).join(', ')}>{card.sub.join('')}</span>}
        <span className="id">{card.id}</span>
      </footer>
    </article>
  )
}

const MEANING_DECKS = ['Серость', 'Случайные', 'Династии'] as const

type Passive = Pick<Item, 'bonus' | 'perSeg' | 'keyCls' | 'rules'>
/** Постоянные свойства карты обычными словами. */
function passiveLines(p: Passive | undefined): string[] {
  if (!p) return []
  const out: string[] = []
  for (const x of p.bonus ?? []) {
    const what = x.adv ? 'преимущество' : x.dis ? 'помеха' : (x.add! > 0 ? '+' : '−') + Math.abs(x.add!)
    out.push(`${what} ${x.tags.join(' ')}${x.if ? ` (если ${renderCond(x.if)})` : ''}`)
  }
  if (p.perSeg) out.push('в начале каждого отрезка:', ...renderNodes(p.perSeg, 1))
  if (p.keyCls) out.push(`ключ к классу ${p.keyCls.join(', ')}`)
  for (const r of p.rules ?? []) out.push(`правило: ${r}`)
  return out
}

function itemLines(it: Item): string[] {
  const out = passiveLines(it)
  if (it.sides) {
    out.push('сторона «Партнёр»:', ...passiveLines(it.sides.partner).map((l) => '  ' + l))
    out.push('сторона «Супруг(а)»:', ...(it.sides.spouse.onWed ? ['  в день свадьбы:', ...renderNodes(it.sides.spouse.onWed, 2)] : []), ...passiveLines(it.sides.spouse).map((l) => '  ' + l))
  }
  if (it.onGain) out.push('при получении:', ...renderNodes(it.onGain, 1))
  if (it.biz) out.push(`дело: ${it.biz.size}, доход Д + ${it.biz.bonus}${it.biz.only ? `, только ${it.biz.only.join(', ')}` : ''}`)
  it.play?.forEach((pl, i) => {
    const check = pl.auto ? 'автоуспех' : pl.add !== undefined ? `+${pl.add}` : ''
    const to = pl.any ? 'в любой проверке' : pl.tags ? `к проверке ${pl.tags.join(' или ')}` : ''
    out.push(`сыграть${it.play!.length > 1 ? ` (${i + 1})` : ''}${pl.label ? ` — ${pl.label}` : ''}: ${[check, to].filter(Boolean).join(' ')}`.trimEnd())
    if (pl.rule) out.push(`  правило: ${pl.rule}`)
    if (pl.effect) out.push(...renderNodes(pl.effect, 1))
  })
  if (it.uses) out.push(`можно сыграть ${it.uses} раза`)
  if (it.risk || it.riskRule) out.push('катастрофа на d6 1–2:', ...(it.risk ? renderNodes(it.risk, 1) : []), ...(it.riskRule ? [`  правило: ${it.riskRule}`] : []))
  if (it.shadow) out.push('тень:', ...passiveLines(it.shadow).map((l) => '  ' + l))
  if (it.sell) out.push(`скупка: ${it.sell}${it.sellRule ? ` (${it.sellRule})` : ''}`)
  else if (it.sellRule) out.push(`скупка: ${it.sellRule}`)
  return out.length ? out : ['без механики']
}

const ITEM_COLOR: Record<string, string> = { 'Верхи': '#C9A13B', 'Дно': '#3A3330' }

function ItemView({ it }: { it: Item }) {
  return (
    <article className={'card' + (it.doubts ? ' doubtful' : '')} style={{ borderTopColor: ITEM_COLOR[it.deck] ?? '#A0643A' }}>
      <header>
        <h3>{it.name}</h3>
        <span className="kind">{it.group ? `${it.group} · ` : ''}{it.kind}{it.copies > 1 ? ` ×${it.copies}` : ''}</span>
      </header>
      <section>
        <h4>Оригинал</h4>
        {Object.entries(it.src).map(([k, v]) => <p key={k} className="src"><span className="ckind">{k}:</span> {v}</p>)}
      </section>
      <section>
        <h4>Разбор</h4>
        <pre className="parsed">{itemLines(it).join('\n')}</pre>
      </section>
      {it.doubts && (
        <section className="doubts">
          <h4>Вопрос к автору</h4>
          {it.doubts.map((d, i) => <p key={i}>{d}</p>)}
        </section>
      )}
    </article>
  )
}

const ITEM_GROUPS: [string, (i: Item) => boolean][] = [
  ['Связи', (i) => i.deck === 'каталог' && i.kind === 'связь'],
  ['Статусы', (i) => i.deck === 'каталог' && i.kind === 'статус'],
  ['Обычные козыри', (i) => i.deck === 'каталог' && i.kind === 'козырь'],
  ['Стигмы', (i) => i.kind === 'стигма'],
  ['Вещи', (i) => i.kind === 'вещь'],
  ['Своё дело', (i) => i.kind === 'дело'],
  ['Колода «Верхи»', (i) => i.deck === 'Верхи'],
  ['Колода «Дно»', (i) => i.deck === 'Дно'],
]

function MeaningView({ m }: { m: Meaning }) {
  return (
    <article className={'card' + (m.doubts ? ' doubtful' : '')} style={{ borderTopColor: '#8A8A86' }}>
      <header>
        <span className="num">{m.deck === 'Династии' ? 'Д' : '№ '}{m.n || ''}</span>
        <h3>{m.title}</h3>
        <span className="kind">{m.difficulty}{m.unusual ? ' · необычный' : ''}</span>
      </header>
      <p className="text">«{m.motto}»</p>
      {m.requires && <p className="req">Требование: {m.requiresText} → {renderCond(m.requires)}</p>}
      <table className="conds">
        <tbody>
          {m.conds.map((c, i) => (
            <tr key={i}>
              <td className="pts">{String(c.points).replace('.', ',')}</td>
              <td>{c.text} <span className="ckind">{c.kind}</span><br /><span className="cparsed">{renderCond(c.cond)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.doubts && (
        <section className="doubts">
          <h4>Вопрос к автору</h4>
          {m.doubts.map((d, i) => <p key={i}>{d}</p>)}
        </section>
      )}
      <footer>
        <span className="tags">{m.tags.join(' ') || '—'}</span>
        <span className="id">{m.id}</span>
      </footer>
    </article>
  )
}

export default function App() {
  const [deckId, setDeckId] = useState<DeckId | 'все' | 'смыслы' | 'предметы'>('все')
  const [onlyDoubts, setOnlyDoubts] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return decks
      .filter((d) => deckId === 'все' || d.deck === deckId)
      .map((d) => ({
        deck: d,
        cards: d.cards.filter((c) =>
          (!onlyDoubts || c.doubts) &&
          (!q || [c.title, c.text, c.src, c.tags.join(' ')].some((s) => s.toLowerCase().includes(q)))),
      }))
      .filter((g) => g.cards.length > 0)
  }, [deckId, onlyDoubts, query])

  const shownMeanings = useMemo(() => {
    if (deckId !== 'смыслы') return []
    const q = query.trim().toLowerCase()
    return meanings.filter((m) =>
      (!onlyDoubts || m.doubts) &&
      (!q || [m.title, m.motto, m.tags.join(' '), ...m.conds.map((c) => c.text)].some((s) => s.toLowerCase().includes(q))))
  }, [deckId, onlyDoubts, query])

  const shownItems = useMemo(() => {
    if (deckId !== 'предметы') return []
    const q = query.trim().toLowerCase()
    return items.filter((it) => (!onlyDoubts || it.doubts) && (!q || [it.name, ...Object.values(it.src)].some((s) => s.toLowerCase().includes(q))))
  }, [deckId, onlyDoubts, query])

  const total = decks.reduce((s, d) => s + d.cards.length, 0)
  const doubts = decks.reduce((s, d) => s + d.cards.filter((c) => c.doubts).length, 0) + meanings.filter((m) => m.doubts).length + items.filter((i) => i.doubts).length

  return (
    <main>
      <header className="top">
        <h1>Жизнь</h1>
        <p className="subtitle">Колоды в цифровом формате — проверка перевода. Карт событий: {total}, смыслов: {meanings.length}, предметов: {items.length} видов, спорных: {doubts}.</p>
        <div className="controls">
          <select value={deckId} onChange={(e) => setDeckId(e.target.value as DeckId | 'все' | 'смыслы' | 'предметы')}>
            <option value="все">Все колоды</option>
            {decks.map((d) => <option key={d.deck} value={d.deck}>{DECKS[d.deck]} ({d.cards.length})</option>)}
            <option value="смыслы">Смыслы ({meanings.length})</option>
            <option value="предметы">Предметы ({items.length})</option>
          </select>
          <label><input type="checkbox" checked={onlyDoubts} onChange={(e) => setOnlyDoubts(e.target.checked)} /> только спорные</label>
          <input type="search" placeholder="поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>
      {shown.map(({ deck, cards }) => (
        <section key={deck.deck} className="deck">
          <h2>{DECKS[deck.deck]}</h2>
          {deck.polar && <p className="legend">Колода по полюсам: псих., физ. и возм. в ветках культуры — для «умеренно», при «сильно» на 1 крупнее (смягчение тоже). Поправки к броску по полюсу — для «сильно», при «умеренно» ±1, кроме помеченных «при любой силе». Бонус тега культуры не добавляется.</p>}
          {deck.sub && <p className="legend">{Object.entries(deck.sub).map(([k, v]) => `${k} — ${v}`).join(' · ')}</p>}
          <div className="grid">
            {cards.map((c) => <CardView key={c.id} card={c} legend={deck.sub} color={DECK_COLOR[deck.deck.split('.')[0]] ?? '#1E1E24'} />)}
          </div>
        </section>
      ))}
      {deckId === 'смыслы' && MEANING_DECKS.map((dk) => {
        const list = shownMeanings.filter((m) => m.deck === dk)
        return list.length === 0 ? null : (
          <section key={dk} className="deck">
            <h2>Смыслы: {dk}</h2>
            {dk === 'Серость' && <p className="legend">Под каждым условием — как его понял движок. «сост.» — пока выполняется; «соб.» — один раз и навсегда; «итог» — в момент смерти.</p>}
            <div className="grid">{list.map((m) => <MeaningView key={m.id} m={m} />)}</div>
          </section>
        )
      })}
      {deckId === 'предметы' && ITEM_GROUPS.map(([title, f]) => {
        const list = shownItems.filter(f)
        return list.length === 0 ? null : (
          <section key={title} className="deck">
            <h2>Предметы: {title}</h2>
            <div className="grid">{list.map((it) => <ItemView key={it.name} it={it} />)}</div>
          </section>
        )
      })}
      {shown.length === 0 && shownMeanings.length === 0 && shownItems.length === 0 && <p className="empty">Ничего не найдено.</p>}
    </main>
  )
}
