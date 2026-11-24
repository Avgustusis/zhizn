/**
 * Пробная партия: отладочный экран ядра. Показывает вопрос движка кнопками, листы игроков и журнал.
 * Это не интерфейс игры (он — этап 5), а способ потрогать правила руками.
 */
import { useEffect, useRef, useState } from 'react'
import { loadContent } from '../data/content.ts'
import { CHAR_AXES, CULTURE_AXES, SEGMENTS, STATS } from '../data/schema.ts'
import { Engine, modeName } from '../engine/engine.ts'
import { aiAnswer } from '../engine/ai/index.ts'
import { ARCHETYPES, bureauName } from '../engine/ai/persona.ts'
import { meaningOf, meaningStatus } from '../engine/meaning.ts'
import type { LogEvent, Option, Player, SaveFile, SeatConfig } from '../engine/types.ts'
import { glyphs, renderNodes } from '../data/render.ts'
import { describe } from './log.ts'

const content = loadContent()

const AI_LEVELS: [NonNullable<SeatConfig['ai']>, string][] = [['easy', 'Легко'], ['normal', 'Нормально'], ['hard', 'Сложно']]
const randomArchetype = () => ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)].id
const newSeat = (ai?: SeatConfig['ai']): SeatConfig => ({ name: bureauName(), ...(ai ? { ai, archetype: randomArchetype() } : {}) })
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

/** Страны: идеология, стабильность, жетоны «Общественного следа» и карты политики. */
function WorldBar({ e }: { e: Engine }) {
  const s = e.state
  return (
    <p className="legend">
      {s.world.countries.map((c) => {
        const tokens = Object.entries(c.trace ?? {}).filter(([, n]) => n > 0).map(([ch, n]) => `СЛЕД ${ch} ${n}`)
        const pol = (c.policies ?? []).filter((x) => x.until > s.worldTurns).map((x) => `«${x.title}» (${x.cls} ${x.add > 0 ? '+1' : '−1'}, до мир. хода ${x.until})`)
        return <span key={c.id}>{c.name}: {c.ideology}, стаб. {c.stability}{[...tokens, ...pol].length ? ` · ${[...tokens, ...pol].join(' · ')}` : ''}<br /></span>
      })}
    </p>
  )
}

/** «Сказка»: что уже собрано в мире. */
function DraftBar({ e }: { e: Engine }) {
  const w = e.state.world
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '—')
  const prof = Object.entries(w.cultures).map(([k, p]) => `${k}: ${CULTURE_AXES.flatMap(([a, b], i) => (p[i] ? [`${p[i] < 0 ? a : b}${Math.abs(p[i]) === 2 ? '!' : ''}`] : [])).join(', ')}`)
  return (
    <div className="legend">
      <p><b>Мир в сборке</b> (! — сильно)</p>
      {w.draft!.map((c) => <p key={c.id}>{c.name} — {c.pos}{c.mainRaces.length ? `, ${c.multicultural ? 'мультикультурная' : 'гомогенная'}` : ''}: расы {list(c.mainRaces)}{c.minorityRaces.length ? ` (меньшинства: ${list(c.minorityRaces)})` : ''}; культуры {list(c.mainCultures)}{c.minorityCultures.length ? ` (меньшинства: ${list(c.minorityCultures)})` : ''}{c.ideology ? `; ${c.ideology}, правит ${c.dominant ?? '?'}, отчуждён ${c.alienated ?? '?'}` : ''}</p>)}
      {prof.length > 0 && <p>Культуры: {prof.join(' · ')}</p>}
      {Object.keys(w.relations).length > 0 && <p>Отношения: {Object.entries(w.relations).map(([k, r]) => `${k.split('-').map((i) => w.draft![Number(i)].name).join(' и ')} — ${r}`).join(' · ')}</p>}
    </div>
  )
}

function Sheet({ e, p, current, nurse }: { e: Engine; p: Player; current: boolean; nurse?: () => void }) {
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
      {p.seg === 5 && p.alive && (
        <p className="num">сиделка: {p.rules['сиделка постоянно'] ? 'постоянно (−2 возм. за ход)' : 'сам (−1 физ. за ход)'} {nurse && <button onClick={nurse}>переключить</button>}</p>
      )}
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
      <p className="src">{glyphs(card.src)}</p>
      <p className="tags">{card.tags.join(' ')}</p>
      {card.trace && <p className="tags">{card.trace}</p>}
      {result.length > 0 && <div className="result"><h4>Что вышло</h4>{result.map((r, i) => <p key={i}>{r}</p>)}</div>}
      {!pending && <button onClick={onClose}>Закрыть карту</button>}
      {pending && <p className="num">выбери вариант ниже</p>}
    </article>
  )
}

/** Причины закрытия, которые игроку важно видеть сразу. */
const SHOWN_OFF = /убеждений|Банк не верит|кредитор не даст|нет денег|не в твоём характере/

/** Вариант ответа: проверка (тег, характеристика, сложность, поправки, шанс) и что будет — без выбора вслепую. */
function OptionButton({ o, market, onPick }: { o: Option; market: boolean; onPick: () => void }) {
  const c = o.check
  const lines = o.effect ? renderNodes(o.effect) : []
  return (
    <div className="option">
      <button onClick={onPick}>{o.label}{o.note ? <span className="num"> {o.note.split(' ‖ ').map((x, i) => <span key={i}>{i ? <br /> : null}{x}</span>)}</span> : null}</button>
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
  const [table, setTable] = useState<SeatConfig[]>(() => [newSeat(), newSeat('normal')])
  const [startMode, setStartMode] = useState<'dice' | 'tale'>('dice')
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
  /** «Ход за ИИ» у человека — ИИ «Нормально» (играет на смысл). */
  const randomId = (x: Engine) => aiAnswer(x.g, x.pending!, x.state.config.seats[x.pending!.player]?.ai ?? 'normal')
  /** Места ИИ ходят сами, пока вопрос не дойдёт до человека; их карты считаются просмотренными. */
  const autoAI = (x: Engine | null) => {
    if (!x) return x
    let moved = false
    for (let i = 0; i < 20000 && x.pending && x.state.config.seats[x.pending.player]?.ai; i++) { x.answer(randomId(x)); moved = true }
    if (moved) { const n = x.state.log.length; queueMicrotask(() => setSeen(n)) }
    return x
  }
  const start = () => act(() => { setSeen(0); return autoAI(new Engine(content, { span: 'one', start: startMode, seed, seats: table.map((t) => ({ ...t })) })) })
  const resume = () => act((x) => { const y = saved ? Engine.load(content, saved) : x; if (y) setSeen(y.state.log.length); return autoAI(y) })
  const answer = (id: string) => act((x) => { x?.answer(id); return autoAI(x) })
  const setSeat = (i: number, patch: Partial<SeatConfig>) => setTable((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)))
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
          <label>Старт <select value={startMode} onChange={(ev) => setStartMode(ev.target.value as 'dice' | 'tale')}><option value="dice">«Быль» — по кубикам («Биография»)</option><option value="tale">«Сказка» — мир и героев собирают («Легенда»)</option></select></label>
          <label>Мест <select value={table.length} onChange={(ev) => { const n = Number(ev.target.value); setTable((t) => (n > t.length ? [...t, ...Array.from({ length: n - t.length }, () => newSeat('normal'))] : t.slice(0, n))) }}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Зерно <input type="number" value={seed} onChange={(ev) => setSeed(Number(ev.target.value) || 0)} style={{ width: '7em' }} /></label>
          <button onClick={start}>Начать</button>
          {saved && <button onClick={resume}>Продолжить сохранённую</button>}
        </div>
        <div className="seats">
          {table.map((t, i) => (
            <div className="seat" key={i}>
              <input value={t.name} onChange={(ev) => setSeat(i, { name: ev.target.value })} placeholder="псевдоним" style={{ width: '16em' }} />
              <button onClick={() => setSeat(i, { name: bureauName() })}>Случайно</button>
              <select value={t.ai ?? ''} onChange={(ev) => setSeat(i, { ai: (ev.target.value || undefined) as SeatConfig['ai'], ...(ev.target.value && !t.archetype ? { archetype: randomArchetype() } : {}) })}>
                <option value="">человек</option>
                {AI_LEVELS.map(([id, label]) => <option key={id} value={id}>ИИ: {label}</option>)}
              </select>
              {!t.ai && startMode === 'tale' && (
                <label className="num">год рождения <input type="number" value={t.born ?? ''} placeholder="—" onChange={(ev) => setSeat(i, { born: ev.target.value ? Number(ev.target.value) : undefined })} style={{ width: '5em' }} /></label>
              )}
              {t.ai && (
                <select value={t.archetype ?? ''} onChange={(ev) => setSeat(i, { archetype: ev.target.value })} title={ARCHETYPES.find((a) => a.id === t.archetype)?.meaning}>
                  {ARCHETYPES.map((a) => <option key={a.id} value={a.id} title={`${a.lang} — ${a.meaning}`}>{a.name} — {a.meaning}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
        {startMode === 'tale' && <p className="legend">«Сказка»: мир собирают люди за столом по очереди, начиная с младшего (год рождения); на каждом вопросе можно ответить «случайно». Героя каждый собирает сам в пределах «Доли»; герои ИИ собираются по архетипу.</p>}
        <p className="legend">Псевдоним — не имя и не фамилия; «Случайно» даёт номер, как в Бюро. ИИ на всех уровнях знает только то, что видит игрок. Архетип — характер ИИ: его решения следуют чертам.</p>
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
      <h2>Пробная партия <span className="num">{modeName(s.config)} · зерно {s.config.seed} · круг {s.round + 1} · мировых ходов {s.worldTurns}</span></h2>
      {s.war && <WarBar e={e} />}
      {s.world.draft && <DraftBar e={e} />}
      <details><summary>страны и «Общественный след»</summary><WorldBar e={e} /></details>
      {error && <p className="req">Ошибка движка: {error} (зерно {s.config.seed})</p>}
      <div className="sheets">{s.players.map((p) => <Sheet key={p.seat} e={e} p={p} current={req?.player === p.seat} nurse={req?.player === p.seat && req.options.some((o) => o.id === 'сиделка') ? () => answer('сиделка') : undefined} />)}</div>

      <div className="log">
        {log.map((ev, i) => { const d = describe(ev, s); return <p key={s.log.length - log.length + i} className={d.kind}>{d.text}</p> })}
        <div ref={logEnd} />
      </div>

      {shownCard ? (
        <CardPanel id={shownCard.id} deck={shownCard.deck} who={s.players[shownCard.p]?.name ?? ''} result={cardResult.map((d) => d.text)} pending={nextCard < 0 && !!req && req.card === shownCard.id} onClose={closeCard} />
      ) : null}
      {(!shownCard || (nextCard < 0 && req?.card === shownCard.id)) && (req ? (
        <div className="ask">
          <p className="who">{s.players[req.player]?.name ?? s.config.seats[req.player]?.name}</p>
          <p className="q">{req.text}</p>
          <div className="options">
            {req.options.filter((o) => !o.off).map((o) => <OptionButton key={o.id} o={o} market={req.type === 'действие'} onPick={() => answer(o.id)} />)}
            {/* Закрытое характером, банком или деньгами — неактивной кнопкой с причиной; прочее — в свёрнутом списке. */}
            {req.options.filter((o) => o.off && SHOWN_OFF.test(o.off)).map((o) => (
              <div className="option" key={o.id}><button disabled>{o.label} <span className="num">— {o.off}{o.note ? o.note.split(' ‖ ').map((x, i) => <span key={i}><br />{x}</span>) : null}</span></button></div>
            ))}
            {req.options.some((o) => o.off && !SHOWN_OFF.test(o.off)) && (
              <details className="closed">
                <summary>недоступно сейчас ({req.options.filter((o) => o.off && !SHOWN_OFF.test(o.off)).length})</summary>
                {req.options.filter((o) => o.off && !SHOWN_OFF.test(o.off)).map((o) => <p key={o.id}>{o.label} <span className="num">— {o.off}</span></p>)}
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
