import { useMemo, useState } from 'react'
import { decks } from './data/index.ts'
import { DECKS, type Card, type DeckId } from './data/schema.ts'
import { renderCond, renderNodes } from './data/render.ts'
import { meanings } from './data/meanings.ts'
import type { Meaning } from './data/schema.ts'

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
  const [deckId, setDeckId] = useState<DeckId | 'все' | 'смыслы'>('все')
  const [onlyDoubts, setOnlyDoubts] = useState(false)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return decks
      .filter((d) => deckId !== 'смыслы' && (deckId === 'все' || d.deck === deckId))
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

  const total = decks.reduce((s, d) => s + d.cards.length, 0)
  const doubts = decks.reduce((s, d) => s + d.cards.filter((c) => c.doubts).length, 0) + meanings.filter((m) => m.doubts).length

  return (
    <main>
      <header className="top">
        <h1>Жизнь</h1>
        <p className="subtitle">Колоды в цифровом формате — проверка перевода. Карт событий: {total}, смыслов: {meanings.length}, спорных: {doubts}.</p>
        <div className="controls">
          <select value={deckId} onChange={(e) => setDeckId(e.target.value as DeckId | 'все' | 'смыслы')}>
            <option value="все">Все колоды</option>
            {decks.map((d) => <option key={d.deck} value={d.deck}>{DECKS[d.deck]} ({d.cards.length})</option>)}
            <option value="смыслы">Смыслы ({meanings.length})</option>
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
      {shown.length === 0 && shownMeanings.length === 0 && <p className="empty">Ничего не найдено.</p>}
    </main>
  )
}
