/**
 * Пробная партия: отладочный экран ядра. Показывает вопрос движка кнопками, листы игроков и журнал.
 * Это не интерфейс игры (он — этап 5), а способ потрогать правила руками.
 */
import { useEffect, useRef, useState } from 'react'
import { loadContent } from '../data/content.ts'
import { CHAR_AXES, SEGMENTS, STATS } from '../data/schema.ts'
import { Engine } from '../engine/engine.ts'
import { answer as aiAnswer } from '../engine/ai/simple.ts'
import { meaningOf, meaningStatus } from '../engine/meaning.ts'
import type { LogEvent, Option, Player, SaveFile } from '../engine/types.ts'
import { renderNodes } from '../data/render.ts'
import { describe } from './log.ts'

const content = loadContent()
const KEY = 'zhizn.trial.v1'
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n).replace('-', '−'))

function loadSaved(): SaveFile | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as SaveFile) : null } catch { return null }
}
function store(e: Engine | null): void {
  try { if (e) localStorage.setItem(KEY, JSON.stringify(e.save())); else localStorage.removeItem(KEY) } catch { /* место кончилось — играем без сохранения */ }
}

/** Идёт война: стороны и метка «Фронта» (с края первой стороны). */
function WarBar({ e }: { e: Engine }) {
  const w = e.state.war!
  const c = e.state.world.countries
  const name = (ids: number[]) => ids.map((id) => `${c[id].name} (${c[id].pos}, ${c[id].ideology})`).join(', ')
  const title = content.front.cells.find((x) => x.cell === w.mark)?.title ?? ''
  return (
    <p className="req">⚔ {w.kind === 'мировая' ? 'Мировая война' : 'Война'}: {name(w.sides[0])} против {name(w.sides[1])} · метка {signed(w.mark)} «{title}» для первой стороны · кругов {w.rounds}</p>
  )
}

function Sheet({ e, p, current }: { e: Engine; p: Player; current: boolean }) {
  const s = e.state
  const country = s.world.countries[p.country]
  const cell = content.board.segments[p.seg].cells[p.cell]
  const status = !p.alive ? `умер: ${p.death?.cause}, ${p.death?.seg}` : p.finished ? 'дошёл до «Финала»' : p.inst ? (p.inst.kind === 'фронт' ? `на «Фронте»${p.inst.foreign ? ' (доброволец, чужая война)' : ''}` : `${p.inst.kind}`) : ''
  const poles = CHAR_AXES.flatMap(([a, b], i) => (p.character[i] ? [`${p.character[i] < 0 ? a : b}${Math.abs(p.character[i]) === 2 ? ' (сильно)' : ''}`] : []))
  const m = meaningOf(e.g, p)
  return (
    <article className={'sheet' + (current ? ' current' : '') + (p.alive ? '' : ' dead')}>
      <header>
        <h3>{p.name}</h3>
        <span className="num">{SEGMENTS[p.seg]}, клетка {cell.n ?? 'Класс'} · {p.cls}{status ? ` · ${status}` : ''}</span>
      </header>
      <p className="vitals">
        <span>физ. <b>{signed(p.phys)}</b></span><span>псих. <b>{signed(p.psy)}</b></span><span>возм. <b>{signed(p.vozm)}</b></span><span>счастье <b>{p.happiness}</b></span>
      </p>
      <details>
        <summary>лист персонажа</summary>
        <p>{p.sex === 'м' ? 'Мужчина' : 'Женщина'}, {p.race}, культура — {p.culture}. Живёт: {country.name} ({country.pos}, {country.ideology}; правит {country.dominant}, отчуждён {country.alienated}).</p>
        <p>Семья: финансы {signed(p.fin)}, положение {signed(p.pos)}, сплочённость {signed(p.coh)}; класс семьи — {p.familyCls}.</p>
        <p>{STATS.map((st) => `${st} ${p.stats[st]}${p.predisp === st ? '*' : ''}`).join(' · ')} <span className="num">(* предрасположенность)</span></p>
        <p>Характер: {poles.join(', ') || 'ровный'}. Стаж {p.stazh}.</p>
        <p>Предметы: {p.items.map((h) => `${h.name}${h.spouse ? ' (Супруг(а))' : ''}`).join(', ') || 'нет'}.</p>
        {m && (
          <>
            <p>Смысл: <b>{m.title}</b>{p.meaning?.verdict ? ` — культура ${p.meaning.verdict > 0 ? 'одобряет' : 'осуждает'}` : ''}</p>
            <ul className="mconds">{meaningStatus(e.g, p).map((k, i) => <li key={i} className={k.met ? 'met' : ''}>{k.met ? '✓' : '·'} {k.text} <span className="num">{k.kind} · {k.points}</span></li>)}</ul>
          </>
        )}
        {!m && <p>Смысл пока не найден.</p>}
      </details>
    </article>
  )
}

/** Событие «Фронта» в виде карты: клетка трека, d10, текст, эффект (строка «Офицер» — в тексте эффекта). */
function frontCard(id: string): (typeof content.decks)[string][number] | undefined {
  const e = content.front.events.find((x) => x.id === id)
  if (!e) return undefined
  const cell = content.front.cells.find((c) => c.cell === e.cell)?.title ?? ''
  return { id: e.id, n: e.n, title: `${e.title} (клетка ${e.cell > 0 ? '+' : ''}${e.cell} «${cell}», d10 = ${e.n})`, text: e.text, src: e.src, kind: 'Б', tags: e.tags, effect: e.effect }
}

/** Карта целиком, как в настольной версии: название, текст, оригинальный эффект, теги — и что из неё вышло. */
function CardPanel({ id, deck, who, result, pending, onClose }: { id: string; deck: string; who: string; result: string[]; pending: boolean; onClose: () => void }) {
  const card = Object.values(content.decks).flat().find((c) => c.id === id) ?? frontCard(id)
  if (!card) return null
  return (
    <article className="cardpanel">
      <p className="who">{who} · {deck}{card.cls ? ` · ${card.cls}` : ''} · {{ 'Б': 'бывает', 'П': 'проверка', 'Р': 'решение' }[card.kind]}</p>
      <h3>{card.title}{card.miracle ? ' ✨' : ''}</h3>
      {card.text && <p className="text">{card.text}</p>}
      <p className="src">{card.src}</p>
      <p className="tags">{card.tags.join(' ')}</p>
      {result.length > 0 && <div className="result"><h4>Что вышло</h4>{result.map((r, i) => <p key={i}>{r}</p>)}</div>}
      {!pending && <button onClick={onClose}>Закрыть карту</button>}
      {pending && <p className="num">выбери вариант ниже</p>}
    </article>
  )
}

/** Вариант ответа: проверка (тег, характеристика, сложность, поправки, шанс) и что будет — без выбора вслепую. */
function OptionButton({ o, market, onPick }: { o: Option; market: boolean; onPick: () => void }) {
  const c = o.check
  const lines = o.effect ? renderNodes(o.effect) : []
  return (
    <div className="option">
      <button onClick={onPick}>{o.label}{o.note ? <span className="num"> {o.note}</span> : null}</button>
      {c && (
        <p className="chk">
          🎲 {c.stat} {c.dc}{c.tags.length ? ` · ${c.tags.join(' ')}` : ''} · у тебя {c.stat} {c.value}
          {c.mod ? `, поправки ${c.mod > 0 ? '+' : ''}${c.mod}` : ''}{c.adv > 0 ? ', преимущество' : c.adv < 0 ? ', помеха' : ''}
          {c.parts.length ? <span className="num"> ({c.parts.join('; ')})</span> : null} · <b>шанс {Math.round(c.chance * 100)}%</b>
        </p>
      )}
      {lines.length > 0 && (market
        ? <details className="what"><summary>что будет</summary><pre className="parsed">{lines.join('\n')}</pre></details>
        : <pre className="parsed">{lines.join('\n')}</pre>)}
    </div>
  )
}

export default function Trial() {
  // Движок меняется на месте, поэтому лежит в обёртке: новая обёртка — новый кадр.
  const [box, setBox] = useState<{ e: Engine | null }>({ e: null })
  const [seats, setSeats] = useState(2)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000))
  const [saved, setSaved] = useState<SaveFile | null>(loadSaved)
  const [error, setError] = useState('')
  /** До какого места журнала игрок уже видел карты: новые карты показываются целиком и закрываются игроком. */
  const [seen, setSeen] = useState(0)
  const logEnd = useRef<HTMLDivElement | null>(null)
  const e = box.e
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }) })

  /** Любое действие с движком: ошибка не роняет страницу, а показывается вместе с зерном для повтора. */
  const act = (fn: (x: Engine | null) => Engine | null) => {
    let next = box.e
    try { setError(''); next = fn(box.e) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    store(next)
    setBox({ e: next })
  }
  /** Ответ за игрока — простой ИИ (лечится, работает, растёт; на смысл не играет). */
  const randomId = (x: Engine) => aiAnswer(x.g, x.pending!)
  const start = () => act(() => { setSeen(0); return new Engine(content, { mode: 'поколение', seed, seats: Array.from({ length: seats }, (_, i) => ({ name: `Игрок ${i + 1}` })) }) })
  const resume = () => act((x) => { const y = saved ? Engine.load(content, saved) : x; if (y) setSeen(y.state.log.length); return y })
  const answer = (id: string) => act((x) => { x?.answer(id); return x })
  /** Отвечать наугад, пока не дойдём до следующего вопроса «твой ход» (или до конца партии). */
  // Карты, сыгранные за ИИ, считаются просмотренными; следующие (ход человека) снова показываются целиком.
  const skipTurn = () => act((x) => {
    if (!x?.pending) return x
    x.answer(randomId(x))
    for (let i = 0; i < 500 && x.pending && x.pending.type !== 'ход'; i++) x.answer(randomId(x))
    const n = x.state.log.length
    queueMicrotask(() => setSeen(n))
    return x
  })
  const skipAll = () => act((x) => {
    for (let i = 0; x && i < 100000 && x.pending; i++) x.answer(randomId(x))
    const n = x?.state.log.length ?? 0
    queueMicrotask(() => setSeen(n))
    return x
  })
  const undo = () => act((x) => {
    if (!x) return x
    const save = x.save()
    return save.answers.length ? Engine.load(content, { ...save, answers: save.answers.slice(0, -1) }) : x
  })
  const quit = () => { store(null); setSaved(null); setError(''); setBox({ e: null }) }

  if (!e) {
    return (
      <section className="trial">
        <h2>Пробная партия</h2>
        <p className="legend">Отладочный экран движка: рождение, поле, карты событий, проверки, здоровье, смысл и счастье; рынок, работа, траты, пенсия, город и знакомства (этап 3а); мировые ходы, кризисы, Смута и эмиграция (3б); война на «Фронте» — призыв, тактика, 140 событий, комиссия, плен, итоги войны (3в). Смысл жизни виден всем: это проверка правил, а не игра.</p>
        <div className="controls">
          <label>Игроков <select value={seats} onChange={(ev) => setSeats(Number(ev.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Зерно <input type="number" value={seed} onChange={(ev) => setSeed(Number(ev.target.value) || 0)} style={{ width: '7em' }} /></label>
          <button onClick={start}>Начать</button>
          {saved && <button onClick={resume}>Продолжить сохранённую</button>}
        </div>
        <p className="legend">Одно и то же зерно с теми же ответами даёт ту же партию: если что-то пошло не так, назови зерно.</p>
        {error && <p className="req">Ошибка движка: {error}</p>}
      </section>
    )
  }

  const s = e.state
  const req = e.pending
  const log = s.log.slice(-80)
  // Выпавшие карты, которые игрок ещё не закрыл: первая из них показывается целиком.
  const from = Math.min(seen, s.log.length)
  const cardAt = s.log.findIndex((ev, i) => i >= from && ev.t === 'карта')
  const shownCard = cardAt >= 0 ? (s.log[cardAt] as Extract<LogEvent, { t: 'карта' }>) : undefined
  const nextCard = cardAt >= 0 ? s.log.findIndex((ev, i) => i > cardAt && (ev.t === 'карта' || ev.t === 'ход')) : -1
  const cardResult = cardAt >= 0 ? s.log.slice(cardAt + 1, nextCard < 0 ? s.log.length : nextCard).map((ev) => describe(ev, s)).filter((d) => d.kind !== 'quiet') : []
  const closeCard = () => setSeen(nextCard < 0 ? s.log.length : nextCard)
  const ranking = [...s.players].sort((a, b) => b.happiness - a.happiness || (b.death?.round ?? 999) - (a.death?.round ?? 999))
  return (
    <section className="trial">
      <h2>Пробная партия <span className="num">зерно {s.config.seed} · круг {s.round + 1} · мировых ходов {s.worldTurns}</span></h2>
      {s.war && <WarBar e={e} />}
      {error && <p className="req">Ошибка движка: {error} (зерно {s.config.seed})</p>}
      <div className="sheets">{s.players.map((p) => <Sheet key={p.seat} e={e} p={p} current={req?.player === p.seat} />)}</div>

      <div className="log">
        {log.map((ev, i) => { const d = describe(ev, s); return <p key={s.log.length - log.length + i} className={d.kind}>{d.text}</p> })}
        <div ref={logEnd} />
      </div>

      {shownCard ? (
        <CardPanel id={shownCard.id} deck={shownCard.deck} who={s.players[shownCard.p]?.name ?? ''} result={cardResult.map((d) => d.text)} pending={nextCard < 0 && !!req && req.card === shownCard.id} onClose={closeCard} />
      ) : null}
      {(!shownCard || (nextCard < 0 && req?.card === shownCard.id)) && (req ? (
        <div className="ask">
          <p className="who">{s.players[req.player].name}</p>
          <p className="q">{req.text}</p>
          <div className="options">
            {req.options.filter((o) => !o.off).map((o) => <OptionButton key={o.id} o={o} market={req.type === 'действие'} onPick={() => answer(o.id)} />)}
            {req.options.some((o) => o.off) && (
              <details className="closed">
                <summary>недоступно сейчас ({req.options.filter((o) => o.off).length})</summary>
                {req.options.filter((o) => o.off).map((o) => <p key={o.id}>{o.label} <span className="num">— {o.off}</span></p>)}
              </details>
            )}
          </div>
        </div>
      ) : (
        <div className="ask">
          <p className="q">Партия окончена.</p>
          <ol>{ranking.map((p) => <li key={p.seat}>{p.name}: счастье {p.happiness}{p.alive ? '' : ` (умер в отрезке «${p.death?.seg}»)`}</li>)}</ol>
        </div>
      ))}
      <div className="controls tools">
        {req && <button onClick={skipTurn}>Ход за ИИ</button>}
        {req && <button onClick={skipAll}>До конца за ИИ</button>}
        {req && <button onClick={undo}>Отменить ответ</button>}
        <button onClick={quit}>Новая партия</button>
      </div>
    </section>
  )
}
