/** Жетон «СЛЕД» и текст с жетонами — компоненты экрана (правила показа — text.ts). */
import type { ReactNode } from 'react'
import { CHANNELS, glyphText, TRACE_COLORS } from './text.ts'

/** Жетон «СЛЕД» канала: цветной кружок с названием. */
export function TraceToken({ channel }: { channel?: string }) {
  const color = channel ? TRACE_COLORS[channel] : '#6B655C'
  return (
    <span className="trace-token" style={{ background: color }} title={channel ? `жетон «Общественного следа»: ${channel}` : 'жетон «Общественного следа»'}>
      СЛЕД{channel ? ` · ${channel}` : ''}
    </span>
  )
}

/**
 * Текст с жетонами: «СЛЕД «Труд»» и ✊ превращаются в цветной жетон (✊ — канала channel, если он известен),
 * остальное — через glyphText.
 */
export function Rich({ text, channel }: { text: string; channel?: string }): ReactNode {
  const out: ReactNode[] = []
  const re = new RegExp(`СЛЕД «(${CHANNELS.join('|')})»|✊`, 'g')
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(glyphText(text.slice(last, m.index)))
    out.push(<TraceToken key={k++} channel={m[1] ?? channel} />)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(glyphText(text.slice(last)))
  return <>{out}</>
}

