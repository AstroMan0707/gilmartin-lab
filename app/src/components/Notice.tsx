import type { ReactNode } from 'react'

export type NoticeTone = 'info' | 'warning' | 'error' | 'good'

/** Glyphs so a notice's meaning never rests on colour alone. */
const ICONS: Record<NoticeTone, string> = {
  info: 'i',
  warning: '!',
  error: '×',
  good: '✓',
}

const LABELS: Record<NoticeTone, string> = {
  info: 'Note',
  warning: 'Warning',
  error: 'Error',
  good: 'Done',
}

export function Notice({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <span className="notice-icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <span>
        <span className="sr-only">{LABELS[tone]}: </span>
        {children}
      </span>
    </div>
  )
}
