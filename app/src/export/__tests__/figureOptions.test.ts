import { describe, expect, it } from 'vitest'
import {
  autoHeightIn,
  defaultExportOptions,
  exportHeightIn,
  MIN_PANEL_PLOT_HEIGHT_IN,
  panelCount,
  panelPlotHeightIn,
  pixelDimensions,
  plottedValuesToCsv,
} from '../figureOptions'

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

describe('export height', () => {
  it('keeps a single-panel figure at 4.5 in, and adds height for each further panel', () => {
    expect(autoHeightIn(1)).toBe(4.5)
    expect(autoHeightIn(2)).toBe(6.75)
    expect(autoHeightIn(3)).toBe(9)
    // Capped so it still fits a page.
    expect(autoHeightIn(6)).toBe(10)
  })

  it('gives every panel a readable plot area up to four panels', () => {
    // A single 4.5 in height used to leave three panels 0.87 in each.
    expect(panelPlotHeightIn(4.5, 3)).toBeLessThan(0.9)
    for (const n of [1, 2, 3, 4]) {
      expect(panelPlotHeightIn(autoHeightIn(n), n)).toBeGreaterThanOrEqual(MIN_PANEL_PLOT_HEIGHT_IN)
    }
  })

  it('uses a typed height exactly, once the user sets one', () => {
    const auto = defaultExportOptions()
    const typed = { ...auto, heightIn: 5, heightAuto: false }
    expect(exportHeightIn(auto, 3)).toBe(9)
    expect(exportHeightIn(typed, 3)).toBe(5)
    expect(pixelDimensions(auto, 3)).toEqual({ width: 3900, height: 5400 })
    expect(pixelDimensions(typed, 3)).toEqual({ width: 3900, height: 3000 })
  })

  it('counts panels by their y-axes', () => {
    expect(panelCount({ xaxis: {}, yaxis: {} })).toBe(1)
    expect(panelCount({ yaxis: {}, yaxis2: {}, yaxis3: {}, xaxis3: {} })).toBe(3)
    expect(panelCount({})).toBe(1)
  })
})

