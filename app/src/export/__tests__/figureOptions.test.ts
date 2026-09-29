import { describe, expect, it } from 'vitest'
import { defaultExportOptions, plottedValuesToCsv } from '../figureOptions'

async function csvText(columns: string[], rows: (string | number | null)[][]) {
  // Read as bytes so the byte-order mark is visible; `text()` would strip it.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    await plottedValuesToCsv({ columns, rows }).arrayBuffer(),
  )
}

describe('plotted-values CSV', () => {
  it('starts with a byte-order mark, so Excel reads "≥" and "–" correctly', async () => {
    const text = await csvText(['Group'], [['≥ 12 s'], ['6–12 s']])
    expect(text.startsWith('﻿')).toBe(true)
    expect(text.slice(1)).toBe('Group\n≥ 12 s\n6–12 s')
  })

  it('stops a text label from running as a formula', async () => {
    const text = await csvText(['Group', 'Mean'], [['=HYPERLINK("x")', -1.5], ['+WT', 3], ['@x', null]])
    const [, a, b, c] = text.slice(1).split('\n')
    expect(a).toBe(`"'=HYPERLINK(""x"")",-1.5`)
    expect(b).toBe(`'+WT,3`)
    expect(c).toBe(`'@x,`)
  })

  it('quotes a value with a carriage return', async () => {
    expect((await csvText(['A'], [['one\rtwo']])).slice(1)).toBe('A\n"one\rtwo"')
  })
})

describe('export options', () => {
  it('leaves the file name blank, so the chart title is used', () => {
    // It used to default to "figure", so every export was figure.png.
    expect(defaultExportOptions().fileName).toBe('')
  })
})
