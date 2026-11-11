/** JSON с переносами только там, где строка не влезает в ширину: файлы колод читаются глазами. */
export function compactJson(value: unknown, width = 110, indent = ''): string {
  const flat = JSON.stringify(value)
  if (flat === undefined) return 'null'
  if (flat.length + indent.length <= width || value === null || typeof value !== 'object') return flat
  const inner = indent + '  '
  if (Array.isArray(value)) {
    return '[\n' + value.map((v) => inner + compactJson(v, width, inner)).join(',\n') + '\n' + indent + ']'
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  return '{\n' + entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${compactJson(v, width, inner)}`).join(',\n') + '\n' + indent + '}'
}
