/**
 * Пробная партия: отладочный экран ядра. Показывает вопрос движка кнопками, листы игроков и журнал.
 * Это не интерфейс игры (он — этап 5), а способ потрогать правила руками.
 */
import { useEffect, useRef, useState } from 'react'
import { loadContent } from '../data/content.ts'
import { CHAR_AXES, SEGMENTS, STATS } from '../data/schema.ts'
import { Engine } from '../engine/engine.ts'
import { meaningOf, meaningStatus } from '../engine/meaning.ts'
import type { Player, SaveFile } from '../engine/types.ts'
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

function Sheet({ e, p, current }: { e: Engine; p: Player; current: boolean }) {
  const s = e.state
  const country = s.world.countries[p.country]
  const cell = content.board.segments[p.seg].cells[p.cell]
  const status = !p.alive ? `умер: ${p.death?.cause}, ${p.death?.seg}` : p.finished ? 'дошёл до «Финала»' : p.inst ? `${p.inst.kind}` : ''
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

export default function Trial() {
  // Движок меняется на месте, поэтому лежит в обёртке: новая обёртка — новый кадр.
  const [box, setBox] = useState<{ e: Engine | null }>({ e: null })
  const [seats, setSeats] = useState(2)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000))
  const [saved, setSaved] = useState<SaveFile | null>(loadSaved)
  const [error, setError] = useState('')
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
  const randomId = (x: Engine) => { const open = x.pending!.options.filter((o) => !o.off); return open[Math.floor(Math.random() * open.length)].id }
  const start = () => act(() => new Engine(content, { mode: 'поколение', seed, seats: Array.from({ length: seats }, (_, i) => ({ name: `Игрок ${i + 1}` })) }))
  const resume = () => act((x) => (saved ? Engine.load(content, saved) : x))
  const answer = (id: string) => act((x) => { x?.answer(id); return x })
  /** Отвечать наугад, пока не дойдём до следующего вопроса «твой ход» (или до конца партии). */
  const skipTurn = () => act((x) => {
    if (!x?.pending) return x
    x.answer(randomId(x))
    for (let i = 0; i < 500 && x.pending && x.pending.type !== 'ход'; i++) x.answer(randomId(x))
    return x
  })
  const skipAll = () => act((x) => { for (let i = 0; x && i < 100000 && x.pending; i++) x.answer(randomId(x)); return x })
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
        <p className="legend">Отладочный экран ядра (этап 2): рождение, поле, карты событий, проверки, здоровье, смысл и счастье. Работы, рынка, трат, эмиграции и мировых событий ещё нет — это этап 3, поэтому здоровье здесь только тает. Смысл жизни виден всем: это проверка правил, а не игра.</p>
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
  const ranking = [...s.players].sort((a, b) => b.happiness - a.happiness || (b.death?.round ?? 999) - (a.death?.round ?? 999))
  return (
    <section className="trial">
      <h2>Пробная партия <span className="num">зерно {s.config.seed} · круг {s.round + 1} · мировых ходов {s.worldTurns}</span></h2>
      {error && <p className="req">Ошибка движка: {error} (зерно {s.config.seed})</p>}
      <div className="sheets">{s.players.map((p) => <Sheet key={p.seat} e={e} p={p} current={req?.player === p.seat} />)}</div>

      <div className="log">
        {log.map((ev, i) => { const d = describe(ev, s); return <p key={s.log.length - log.length + i} className={d.kind}>{d.text}</p> })}
        <div ref={logEnd} />
      </div>

      {req ? (
        <div className="ask">
          <p className="who">{s.players[req.player].name}</p>
          <p className="q">{req.text}</p>
          <div className="options">
            {req.options.map((o) => (
              <button key={o.id} disabled={!!o.off} onClick={() => answer(o.id)} title={o.off}>
                {o.label}{o.note ? <span className="num"> {o.note}</span> : null}{o.off ? <span className="num"> — {o.off}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ask">
          <p className="q">Партия окончена.</p>
          <ol>{ranking.map((p) => <li key={p.seat}>{p.name}: счастье {p.happiness}{p.alive ? '' : ` (умер в отрезке «${p.death?.seg}»)`}</li>)}</ol>
        </div>
      )}
      <div className="controls tools">
        {req && <button onClick={skipTurn}>Ход наугад</button>}
        {req && <button onClick={skipAll}>До конца наугад</button>}
        {req && <button onClick={undo}>Отменить ответ</button>}
        <button onClick={quit}>Новая партия</button>
      </div>
    </section>
  )
}
