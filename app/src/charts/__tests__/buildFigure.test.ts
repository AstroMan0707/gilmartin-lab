import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTrialRows } from '../../analysis/rows'
import { joinMetadata } from '../../parse/joinMetadata'
import { parseRatInfo } from '../../parse/parseRatInfo'
import { parseSession } from '../../parse/parseSession'
import { FIXTURE_DIR, FIXTURE_PAIRS, readFixture } from '../../parse/__tests__/fixtures'
import { buildRegistry } from '../../variables/registry'
import { buildFigure } from '../buildFigure'
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
