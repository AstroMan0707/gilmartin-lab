import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aggregate } from '../../analysis/aggregate'
import { buildTrialRows } from '../../analysis/rows'
import { joinMetadata } from '../../parse/joinMetadata'
import { parseRatInfo } from '../../parse/parseRatInfo'
import { parseSession } from '../../parse/parseSession'
import { FIXTURE_DIR, FIXTURE_PAIRS, readFixture } from '../../parse/__tests__/fixtures'
import { buildRegistry } from '../../variables/registry'
import { buildFigure, tukeyFences } from '../buildFigure'
import { defaultSpec, type ChartType } from '../spec'
import { PRINT_THEME } from '../theme'

async function setup() {
  const { subjects } = await parseRatInfo(new Blob([new Uint8Array(readFileSync(join(FIXTURE_DIR, 'Rat Info.xlsx')))]))
  const { sessions, warnings } = joinMetadata(FIXTURE_PAIRS.map((p) => parseSession(p.xml, readFixture(p.xml))), subjects)
  const dataset = { sessions, subjects, warnings, loadedAt: new Date(0), xmlFileNames: [], ratInfoFileName: 'x' }
  const registry = buildRegistry(dataset)
  return { registry, rows: buildTrialRows(dataset, registry, { includeCorrectionTrials: false }) }
}

describe('figure layout', () => {
  it.each([
    ['bar', 'genotype', false],
    ['box', 'genotype', false],
    ['line', 'distance', true],
  ] as [ChartType, string, boolean][])(
    'draws vertical gridlines on a %s chart only where they help: %s',
    async (type, xKey, grid) => {
      // A line at every bar or box read as an error bar, most visibly on a group of one rat.
      const { registry, rows } = await setup()
      const figure = buildFigure(rows, { ...defaultSpec(), type, measureKeys: ['percentCorrect'], xKey }, registry, PRINT_THEME)
      expect((figure.layout.xaxis as { showgrid?: boolean }).showgrid).toBe(grid)
    },
  )

  it('draws no error bar for a group of one', async () => {
    // AD holds one rat in the fixtures. A zero-length cap used to be drawn for it, beside a
    // notice saying it had no error bar.
    const { registry, rows } = await setup()
    const figure = buildFigure(rows, { ...defaultSpec(), type: 'bar', measureKeys: ['percentCorrect'], xKey: 'genotype' }, registry, PRINT_THEME)
    const trace = figure.data[0] as { x: string[]; error_y: { array: number[] } }
    const sem = Object.fromEntries(trace.x.map((g, i) => [g, trace.error_y.array[i]]))
    expect(sem.AD).toBeNaN()
    expect(sem.WT).toBeGreaterThan(0)
  })

  it('draws exports on white', async () => {
    const { registry, rows } = await setup()
    const figure = buildFigure(rows, { ...defaultSpec(), type: 'bar', measureKeys: ['percentCorrect'], xKey: 'genotype' }, registry, PRINT_THEME)
    expect(figure.layout.paper_bgcolor).toBe('#ffffff')
    expect(figure.layout.plot_bgcolor).toBe('#ffffff')
  })
})

describe('box plots', () => {
  it('draw each box from the summary table\'s own median and quartiles', async () => {
    // Plotly's quartile methods all differ from the table's, so a box left to Plotly
    // disagreed with the numbers printed beneath it. Many values per group, so they would.
    const { registry, rows } = await setup()
    const spec = { ...defaultSpec(), type: 'box' as const, measureKeys: ['rewardLatency'], xKey: 'genotype', unit: 'trial' as const }
    const figure = buildFigure(rows, spec, registry, PRINT_THEME)
    const table = aggregate(rows, 'rewardLatency', ['genotype'], 'trial', registry)

    const boxes = figure.data as { x: string[]; q1: number[]; median: number[]; q3: number[]; y: number[][] }[]
    expect(boxes).toHaveLength(table.length)
    for (const cell of table) {
      const box = boxes.find((b) => b.x[0] === cell.group.label)!
      expect(box.q1[0]).toBe(cell.stats.q1)
      expect(box.median[0]).toBe(cell.stats.median)
      expect(box.q3[0]).toBe(cell.stats.q3)
      // The individual values still go in, so the points are drawn beside the box.
      expect(box.y[0]).toHaveLength(cell.stats.n)
    }
  })

  it('end the whiskers at the furthest values within 1.5 × IQR of the box', () => {
    // Q1 3, Q3 7: the whiskers may reach 6 beyond the box, so 30 is left as an outlier.
    expect(tukeyFences([1, 2, 3, 4, 5, 6, 7, 8, 30], 3, 7)).toEqual({ lower: 1, upper: 8 })
    // With nothing outside that reach, the whiskers are the minimum and maximum.
    expect(tukeyFences([50], 50, 50)).toEqual({ lower: 50, upper: 50 })
  })
})

describe('line graphs', () => {
  it('break the line where a series has no data, instead of joining across the gap', async () => {
    // AD with no trials at separation distance 5. Its line used to list only the distances it
    // had, so Plotly drew straight from 4 to 6 as if 5 had been measured.
    const { registry, rows } = await setup()
    const gappy = rows.filter((r) => !(r.values.genotype === 'AD' && r.values.distance === 5))
    const spec = { ...defaultSpec(), type: 'line' as const, measureKeys: ['percentCorrect'], xKey: 'distance', seriesKey: 'genotype' }
    const figure = buildFigure(gappy, spec, registry, PRINT_THEME)

    const lines = figure.data as { name: string; x: string[]; y: (number | null)[]; connectgaps: boolean }[]
    const ad = lines.find((l) => l.name === 'AD')!
    const wt = lines.find((l) => l.name === 'WT')!
    // Both lines run over the same, full axis.
    expect(ad.x).toEqual(wt.x)
    const at = (line: typeof ad, level: string) => line.y[line.x.indexOf(level)]
    expect(at(ad, '5')).toBeNull()
    expect(at(ad, '4')).not.toBeNull()
    expect(at(ad, '6')).not.toBeNull()
    expect(at(wt, '5')).not.toBeNull()
    expect(ad.connectgaps).toBe(false)
  })
})
