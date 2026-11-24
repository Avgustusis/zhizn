/**
 * Сверка движка с Python-симуляцией автора (reference/engine/sim3.py, отчёт reference/docs/report.md).
 *
 *   npx tsx tools/compare.ts [партий=600] [зерно=1]          — таблица в консоль (markdown)
 *   AI=simple npx tsx tools/compare.ts 600                     — каким ИИ играть (по умолчанию — ИИ этапа 4)
 *
 * Режим — «Биография» (одна жизнь, 4 игрока), как «Поколение» в отчёте. Значения симуляции — из финальной проверки
 * 11.11 и последних прогонов автора (счастье 6,46 — сверка 19.11 из концепции, «Сказка: социальный эксперимент»).
 */
import { loadContent } from '../src/data/content.ts'
import { Engine } from '../src/engine/engine.ts'
import { aiAnswer, type AiKind } from '../src/engine/ai/index.ts'
import { ARCHETYPES } from '../src/engine/ai/persona.ts'
import type { Player } from '../src/engine/types.ts'

const N = Number(process.argv[2] ?? 600)
const SEED = Number(process.argv[3] ?? 1)
const AI = (process.env.AI ?? 'normal') as AiKind
/** MIX=уровень — место 1 играет этим уровнем, остальные — AI: доля побед места 1 показывает силу уровня (честно — 25%). */
const MIX = process.env.MIX as AiKind | undefined
let mixWins = 0, mixHap = 0, mixGames = 0
const content = loadContent()
const childNames = new Set(content.items.filter((i) => i.group === 'Ребёнок').map((i) => i.name))

type Life = { kidMoved?: string; born: { ideo: string; pos: string; stab: number }; fall?: string; armyLeft?: string; p: Player; pos: string; win: boolean; teenAsylum: boolean; diploma: boolean; oath: boolean; officer: boolean; married: boolean; child: boolean; emig: boolean; deck: string; diff: string }
const lives: Life[] = []
const checks: Record<string, number> = {}
let errors = 0

for (let seed = SEED; seed < SEED + N; seed++) {
  if (process.env.PROGRESS) console.error(`партия ${seed}`)
  let e: Engine
  let bornAt: Life['born'][] | undefined
  try {
    e = new Engine(content, { span: 'one', seed, seats: [0, 1, 2, 3].map((i) => ({ name: `И${i + 1}`, ai: MIX && i === 0 ? MIX : AI, ...(process.env.ARCH === '0' ? {} : { archetype: ARCHETYPES[(seed * 4 + i) % ARCHETYPES.length].id }) })), keepLog: true }, { checkpoints: AI === 'unfair' || MIX === 'unfair' })
    while (e.pending) {
      // Страна рождения — какой она была на первом ходу (потом строй меняется).
      if (!bornAt && e.pending.type === 'ход') bornAt = e.state.players.map((p) => { const c = e.state.world.countries[p.birthCountry]; return { ideo: c.ideology, pos: c.pos, stab: c.stability } })
      e.answer(aiAnswer(e.g, e.pending, undefined, e))
    }
  } catch (err) { errors++; if (errors <= 3) console.error(`партия ${seed}:`, String(err).slice(0, 300)); continue }
  const s = e.state
  const seg: Record<number, string> = {}
  const flags = s.players.map(() => ({ teenAsylum: false, diploma: false, oath: false, officer: false, married: false, child: false }))
  // Причина смены класса: последняя карта игрока (колода и название) или мировое событие перед ней.
  const lastCard: Record<number, string> = {}
  const lastSay: Record<number, string> = {}
  let lastWorld = ''
  const kidMoved: Record<number, string> = {}
  const fall: Record<number, string> = {}
  const armyLeft: Record<number, string> = {}
  for (const ev of s.log) {
    if (ev.t === 'отрезок') seg[ev.p] = ev.seg
    if (ev.t === 'карта') lastCard[ev.p] = `${ev.deck}: ${ev.title}`
    if (ev.t === 'мир') lastWorld = ev.text
    if (ev.t === 'ход') { delete lastCard[ev.p]; delete lastSay[ev.p] }
    if (ev.t === 'текст') lastSay[ev.p] = ev.text
    if (ev.t === 'класс') {
      const why = lastCard[ev.p] ?? `${lastWorld ? 'мировой ход' : 'правило'} — ${(lastSay[ev.p] ?? lastWorld).slice(0, 70)}`
      if (['Детство', 'Юность'].includes(seg[ev.p] ?? 'Детство') && !kidMoved[ev.p]) kidMoved[ev.p] = `${ev.from} → ${ev.to} (${lastCard[ev.p] ?? 'правило'})`
      if (ev.from === 'Олигархи' && s.players[ev.p].start.cls === 'Олигархи' && !fall[ev.p]) fall[ev.p] = why
      if (ev.from === 'Армия' && s.players[ev.p].start.cls === 'Армия' && !armyLeft[ev.p] && ['Детство', 'Юность'].includes(seg[ev.p] ?? 'Детство')) armyLeft[ev.p] = why
    }
    if (ev.t === 'проверка') checks[ev.stat] = (checks[ev.stat] ?? 0) + 1
    if (ev.t === 'институт' && ev.how === 'вход' && ev.kind === 'психбольница' && seg[ev.p] === 'Юность') flags[ev.p].teenAsylum = true
    if (ev.t === 'предмет' && (ev.how === 'получен' || ev.how === 'свадьба')) {
      const f = flags[ev.p]
      if (ev.name === 'Диплом') f.diploma = true
      if (ev.name === 'Присяга') f.oath = true
      if (ev.name === 'Офицерское звание') f.officer = true
      if (ev.how === 'свадьба') f.married = true
      if (childNames.has(ev.name)) f.child = true
    }
  }
  // Победитель «Биографии»: больше всего счастья; ничья — кто умер позже (жив до конца — позже всех).
  const late = (p: Player) => (p.death ? p.death.round : 1e9)
  const best = [...s.players].sort((a, b) => b.happiness - a.happiness || late(b) - late(a))[0]
  if (MIX) { mixGames++; mixHap += s.players[0].happiness; if (best === s.players[0]) mixWins++ }
  for (const p of s.players) {
    const m = p.meaning ? content.meanings.find((x) => x.id === p.meaning!.id) : undefined
    lives.push({
      p, pos: s.world.countries[p.birthCountry].pos, win: p === best, ...flags[p.seat],
      born: bornAt?.[p.seat] ?? { ideo: '?', pos: '?', stab: 0 }, ...(fall[p.seat] ? { fall: fall[p.seat] } : {}), ...(armyLeft[p.seat] ? { armyLeft: armyLeft[p.seat] } : {}), ...(kidMoved[p.seat] ? { kidMoved: kidMoved[p.seat] } : {}),
      emig: (p.counters['эмиграция'] ?? 0) + (p.counters['бегство'] ?? 0) > 0,
      deck: m?.deck ?? 'нет', diff: m?.difficulty ?? 'нет',
    })
  }
}

const L = lives.length
const pct = (n: number, d = L) => (d ? `${Math.round((100 * n) / d)}%` : '—')
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const f1 = (x: number) => x.toFixed(1).replace('.', ',')
const f2 = (x: number) => x.toFixed(2).replace('.', ',')
const share = (pred: (l: Life) => boolean, of: (l: Life) => boolean = () => true) => { const d = lives.filter(of); return pct(d.filter(pred).length, d.length) }
const per = (key: string) => f1(avg(lives.map((l) => l.p.counters[`действие:${key}`] ?? 0)))
const perAll = (...keys: string[]) => f1(avg(lives.map((l) => keys.reduce((s, k) => s + (l.p.counters[`действие:${k}`] ?? 0), 0))))
const hap = lives.map((l) => l.p.happiness).sort((a, b) => a - b)
const byPos = (pos: string, seg: number) => share((l) => l.p.seg >= seg || (l.p.finished && l.p.seg >= seg), (l) => l.pos === pos)
const deaths = lives.filter((l) => l.p.death)
const psyDeath = deaths.filter((l) => /псих/.test(l.p.death!.cause)).length
const checksAll = Object.values(checks).reduce((a, b) => a + b, 0)
const born = (cls: string) => (l: Life) => l.p.start.cls === cls
const diffAvg = (d: string) => f1(avg(lives.filter((l) => l.diff === d).map((l) => l.p.happiness)))

const rows: [string, string, string][] = [
  ['Счастье: среднее / медиана', `${f2(avg(hap))} / ${f1(hap[Math.floor(L / 2)] ?? 0)}`, '6,46 / 6,5'],
  ['Счастливых (7+) / пустых (3 и ниже)', `${share((l) => l.p.happiness >= 7)} / ${share((l) => l.p.happiness <= 3)}`, '54% / 11%'],
  ['Смысл: Простые / Средние / Сложные', `${diffAvg('Простой')} / ${diffAvg('Средний')} / ${diffAvg('Сложный')}`, '6,8 / 6,2 / 6,0'],
  ['Счастье: Случайные / Династии / Серость', `${f1(avg(lives.filter((l) => l.deck === 'Случайные').map((l) => l.p.happiness)))} / ${f1(avg(lives.filter((l) => l.deck === 'Династии').map((l) => l.p.happiness)))} / ${f1(avg(lives.filter((l) => l.deck === 'Серость').map((l) => l.p.happiness)))}`, '6,6 / 6,7 / 5,5'],
  ['Серость (доля жизней)', share((l) => l.deck === 'Серость'), '10%'],
  ['Победы на игрока: Случайные / Династии', `${share((l) => l.win, (l) => l.deck === 'Случайные')} / ${share((l) => l.win, (l) => l.deck === 'Династии')}`, '27% / 32%'],
  ['Победы рождённых в Мафии / в Народе', `${share((l) => l.win, born('Мафия'))} / ${share((l) => l.win, born('Народ'))}`, '35% / 23%'],
  ['До Старости: ядро / полупериферия / периферия', `${byPos('ядро', 4)} / ${byPos('полупериферия', 4)} / ${byPos('периферия', 4)}`, '97% / 95% / 89%'],
  ['До Древности: ядро / полупериферия / периферия', `${byPos('ядро', 5)} / ${byPos('полупериферия', 5)} / ${byPos('периферия', 5)}`, '65% / 57% / 27%'],
  ['Смерти от психики среди смертей', pct(psyDeath, deaths.length), '24%'],
  ['Подростковый срыв / подростковая психбольница', `${share((l) => !!l.p.teenBreak)} / ${share((l) => l.teenAsylum)}`, '7,9% / 4,5%'],
  ['Кабала: заходов на 100 жизней', f1((100 * avg(lives.map((l) => l.p.counters['кабала'] ?? 0)))), '1,9'],
  ['Тюрьма / психбольница: хоть раз', `${share((l) => (l.p.counters['тюрьма'] ?? 0) > 0)} / ${share((l) => (l.p.counters['психбольница'] ?? 0) > 0)}`, '—'],
  ['Олигархи теряют класс (рождённые там)', share((l) => l.p.cls !== 'Олигархи', born('Олигархи')), '10%'],
  ['Брак / дети', `${share((l) => l.married)} / ${share((l) => l.child)}`, '78% / 77%'],
  ['Диплом', share((l) => l.diploma), '30%'],
  ['Интеллигенция: при рождении / к концу', `${share(born('Интеллигенция'))} / ${share((l) => l.p.cls === 'Интеллигенция')}`, '15% / 20%'],
  ['У рождённых в Армии: Присяга / звание', `${share((l) => l.oath, born('Армия'))} / ${share((l) => l.officer, born('Армия'))}`, '70% / 38%'],
  ['Эмигрировали', share((l) => l.emig), '10%'],
  ['Психика к концу / доля +3 и выше', `${f1(avg(lives.map((l) => l.p.psy)))} / ${share((l) => l.p.psy >= 3)}`, '+4,5 / 69%'],
  ['За жизнь: курсы / салон / спортзал', `${per('курсы')} / ${per('салон')} / ${per('спортзал')}`, '1,6 / 0,8 / 0,6'],
  ['За жизнь: больница / психолог', `${perAll('больница', 'больница-льгота', 'больница-старость', 'больница-старцы', 'больница-большой', 'больница-большой-вещь', 'больница-большой-старцы')} / ${perAll('психолог', 'психолог-льгота', 'психолог-большой', 'психолог-привычка')}`, '11,9 / 2,6'],
  ['Проверки: Харизма / Сила / Красота', `${pct(checks['Харизма'] ?? 0, checksAll)} / ${pct(checks['Сила'] ?? 0, checksAll)} / ${pct(checks['Красота'] ?? 0, checksAll)}`, '21% / 5% / 6%'],
]

if (MIX) console.log(`Место 1 — ${MIX}, остальные — ${AI}: побед ${Math.round((100 * mixWins) / mixGames)}% (честная доля 25%), счастье места 1 ${(mixHap / mixGames).toFixed(2)}`)
console.log(`ИИ: ${AI}; партий ${N - errors} из ${N} (ошибок ${errors}), жизней ${L}, зерно с ${SEED}\n`)
console.log('| Показатель | Движок | Симуляция |\n|---|---|---|')
for (const [a, b, c] of rows) console.log(`| ${a} | ${b} | ${c} |`)

// ── Разбивки (DETAIL=1): падения Олигархов, армейские семьи ──
if (process.env.DETAIL) {
  const olig = lives.filter((l) => l.p.start.cls === 'Олигархи')
  const group = (key: (l: Life) => string, list: Life[], pred: (l: Life) => boolean) => {
    const m = new Map<string, [number, number]>()
    for (const l of list) { const k = key(l); const v = m.get(k) ?? [0, 0]; v[1]++; if (pred(l)) v[0]++; m.set(k, v) }
    return [...m].sort((a, b) => b[1][1] - a[1][1]).map(([k, [n, d]]) => `| ${k} | ${d} | ${pct(n, d)} |`).join('\n')
  }
  const fell = (l: Life) => l.p.cls !== 'Олигархи'
  const stable = (l: Life) => ['Либеральная демократия', 'Социал-демократия', 'Технократия'].includes(l.born.ideo) && l.born.pos === 'ядро'
  console.log(`\n### Олигархи по рождению: ${olig.length} жизней, к концу не Олигархи — ${pct(olig.filter(fell).length, olig.length)}`)
  console.log(`Стабильные (ЛД, СД, технократия в ядре): ${pct(olig.filter(stable).filter(fell).length, olig.filter(stable).length)} из ${olig.filter(stable).length}; остальные: ${pct(olig.filter((l) => !stable(l)).filter(fell).length, olig.filter((l) => !stable(l)).length)}`)
  console.log('\n| Строй страны рождения | Жизней | Упали |\n|---|---|---|'); console.log(group((l) => l.born.ideo, olig, fell))
  console.log('\n| Позиция страны рождения | Жизней | Упали |\n|---|---|---|'); console.log(group((l) => l.born.pos, olig, fell))
  console.log('\n| Стабильность при рождении | Жизней | Упали |\n|---|---|---|'); console.log(group((l) => (l.born.stab >= 7 ? '7+' : l.born.stab >= 4 ? '4–6' : '3 и ниже'), olig, fell))
  const why = new Map<string, number>()
  for (const l of olig) if (l.fall) why.set(l.fall.replace(/: .*/, ''), (why.get(l.fall.replace(/: .*/, '')) ?? 0) + 1)
  console.log('\nПервое падение — откуда (колода последней карты): ' + [...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '))
  const cards = new Map<string, number>()
  for (const l of olig) if (l.fall) cards.set(l.fall, (cards.get(l.fall) ?? 0) + 1)
  console.log('Карты и правила: ' + [...cards].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => `${k} ${n}`).join('; '))
  const army = lives.filter((l) => l.p.start.cls === 'Армия')
  const left = army.filter((l) => l.armyLeft)
  console.log(`\n### Армия по рождению: ${army.length} жизней; ушли из класса в Детстве или Юности — ${pct(left.length, army.length)}`)
  const lw = new Map<string, number>()
  for (const l of left) lw.set(l.armyLeft!, (lw.get(l.armyLeft!) ?? 0) + 1)
  console.log('Причины: ' + [...lw].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join('; '))
  const moved = lives.filter((l) => l.kidMoved)
  console.log(`\n### Дети: сменили класс до Молодости — ${pct(moved.length, lives.length)} всех жизней`)
  const mv = new Map<string, number>()
  for (const l of moved) { const k = l.kidMoved!.replace(/^.*\((.*)\)$/, '$1'); mv.set(k, (mv.get(k) ?? 0) + 1) }
  console.log('Чем: ' + [...mv].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k} ${n}`).join('; '))
  const asked = army.filter((l) => l.oath || l.p.counters['отказ от Присяги'])
  console.log(`«Присяга»: приняли ${pct(army.filter((l) => l.oath).length, army.length)} рождённых в Армии; отказались ${pct(army.filter((l) => l.p.counters['отказ от Присяги']).length, army.length)}; спросили ${pct(asked.length, army.length)}`)
}
