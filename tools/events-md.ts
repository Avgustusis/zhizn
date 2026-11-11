/** Чтение таблиц карт из документа колод (Markdown). */

/** Первая таблица после заголовка `header` (строка целиком, например «### Детство (42)» или «## Чудеса»). */
export function readTable(md: string, header: string): Record<string, string>[] {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.startsWith(header))
  if (start < 0) throw new Error(`нет раздела «${header}»`)
  let i = start + 1
  while (i < lines.length && !lines[i].startsWith('|')) i++
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const head = cells(lines[i])
  const out: Record<string, string>[] = []
  for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const row = cells(lines[i])
    if (row.length !== head.length) throw new Error(`строка ${i + 1}: ${row.length} ячеек вместо ${head.length}`)
    out.push(Object.fromEntries(head.map((h, j) => [h, row[j]])))
  }
  return out
}

/**
 * Все таблицы раздела по началу заголовка («### Детство» найдёт «### Детство (42)»)
 * до следующего заголовка того же или более высокого уровня. Подразделы («#### …») входят.
 */
export function sectionRows(md: string, header: string): Record<string, string>[] {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.startsWith(header))
  if (start < 0) throw new Error(`нет раздела «${header}»`)
  const level = header.match(/^#+/)![0].length
  let end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && l.match(/^#+/)![0].length <= level)
  if (end < 0) end = lines.length
  const rows: Record<string, string>[] = []
  for (let i = start + 1; i < end; i++) {
    if (!lines[i].startsWith('|') || lines[i - 1].startsWith('|')) continue
    rows.push(...readTable(lines.slice(i - 1, end).join('\n'), lines[i - 1]))
  }
  return rows
}
