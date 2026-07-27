import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { joinMetadata } from '../../parse/joinMetadata'
import { parseRatInfo } from '../../parse/parseRatInfo'
import { parseSession } from '../../parse/parseSession'
import { FIXTURE_DIR, FIXTURE_PAIRS, readFixture } from '../../parse/__tests__/fixtures'
import type { Dataset } from '../../types'
import { buildRegistry } from '../../variables/registry'
import { aggregate, collapseToUnit, describe as describeStats, groupBy } from '../aggregate'
import { applyBins, binLabelOrder, binnedKey, computeBins, defaultBinSpec } from '../binning'
import { buildSessionRows, buildTrialRows } from '../rows'

async function loadDataset(): Promise<Dataset> {
  const buf = readFileSync(join(FIXTURE_DIR, 'Rat Info.xlsx'))
  const { subjects } = await parseRatInfo(new Blob([new Uint8Array(buf)]))
  const parsed = FIXTURE_PAIRS.map((p) => parseSession(p.xml, readFixture(p.xml)))
  const { sessions, warnings } = joinMetadata(parsed, subjects)
  return {
    sessions,
    subjects,
    warnings,
    loadedAt: new Date(0),
    xmlFileNames: FIXTURE_PAIRS.map((p) => p.xml),
    ratInfoFileName: 'Rat Info.xlsx',
  }
}

describe('variable registry', () => {
  it('exposes the independent variables the lab cares about', async () => {
    const registry = buildRegistry(await loadDataset())
    const keys = new Set(registry.variables.map((v) => v.key))

    for (const k of ['genotype', 'sex', 'set', 'delaySec', 'sessionNumber', 'distance', 'sampleSide']) {
      expect(keys.has(k), `missing IV ${k}`).toBe(true)
      expect(registry.byKey.get(k)?.role).toBe('IV')
    }
    for (const k of ['percentCorrect', 'rewardLatency', 'correctImageLatency', 'incorrectImageLatency']) {
      expect(keys.has(k), `missing DV ${k}`).toBe(true)
      expect(registry.byKey.get(k)?.role).toBe('DV')
    }
  })

  it('gives verbose ABET markers readable labels', async () => {
    const registry = buildRegistry(await loadDataset())
    expect(registry.byKey.get('centreBlankTouches')?.label).toBe('Centre Blank Touches')
    expect(registry.byKey.get('distance')?.label).toBe('Separation Distance')
    // Only the delay and separation axes are valid line-graph x-axes among these.
    expect(registry.byKey.get('distance')?.ordered).toBe(true)
    expect(registry.byKey.get('sampleSide')?.ordered).toBe(false)
  })

  it('hides the information-free _Counts columns from analysis', async () => {
    const registry = buildRegistry(await loadDataset())
    expect(registry.variables.some((v) => v.markerName?.endsWith('_Counts'))).toBe(false)
  })

  it('marks latencies as binnable so they can become grouping variables', async () => {
    const registry = buildRegistry(await loadDataset())
    expect(registry.byKey.get('correctImageLatency')?.binnable).toBe(true)
    expect(registry.byKey.get('genotype')?.binnable).toBe(false)
  })
})

describe('row building', () => {
  it('excludes correction trials by default and includes them on request', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)

    const excluded = buildTrialRows(dataset, registry, { includeCorrectionTrials: false })
    const included = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    // 99 + 86 + 31 attempts in total across the three fixtures.
    expect(included).toHaveLength(99 + 86 + 31)
    expect(excluded.length).toBeLessThan(included.length)
    expect(excluded.every((r) => r.values.isCorrectionTrial === 0)).toBe(true)
  })

  it('denormalises subject metadata onto every trial row', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    expect(rows.every((r) => r.values.genotype === 'WT' || r.values.genotype === 'AD')).toBe(true)
    expect(new Set(rows.map((r) => r.values.animalId))).toEqual(
      new Set(['LZ039', 'LZ041', 'LZ122']),
    )
  })

  it('keeps missing latencies null rather than zero on trial rows', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const rewards = rows.map((r) => r.values.rewardLatency)
    expect(rewards.some((v) => v === null)).toBe(true)
    expect(rewards.some((v) => v === 0)).toBe(false)
  })

  it('builds one session row per file, agreeing with ABET on accuracy', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildSessionRows(dataset, registry, { includeCorrectionTrials: false })

    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.values.percentCorrect as number).toBeCloseTo(
        row.values.abetPercentCorrect as number,
        2,
      )
      expect(row.values.trialsAnalysed).toBe(row.values.abetTrialsCompleted)
    }
  })
})

describe('descriptive statistics', () => {
  it('computes the quartile summary a box plot needs', () => {
    const stats = describeStats([1, 2, 3, 4, 5, 6, 7, 8])
    expect(stats.n).toBe(8)
    expect(stats.median).toBe(4.5)
    expect(stats.q1).toBe(2.75)
    expect(stats.q3).toBe(6.25)
    expect(stats.iqr).toBeCloseTo(3.5, 10)
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(8)
  })

  it('counts nulls as missing instead of zero', () => {
    const stats = describeStats([2, null, 4, null])
    expect(stats.n).toBe(2)
    expect(stats.missing).toBe(2)
    expect(stats.mean).toBe(3)
  })

  it('reports no error bar for a single observation', () => {
    // An SEM of 0 would draw a zero-length error bar, implying certainty from one rat.
    const stats = describeStats([5])
    expect(stats.n).toBe(1)
    expect(stats.sd).toBeNull()
    expect(stats.sem).toBeNull()
  })
})

describe('aggregation unit', () => {
  it('makes n the number of rats, not the number of trials', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    const byTrial = aggregate(rows, 'correctImageLatency', [], 'trial', registry)
    const bySubject = aggregate(rows, 'correctImageLatency', [], 'subject', registry)

    // This is the pseudo-replication guard: three rats must give n = 3, not n = 150+.
    expect(bySubject[0].stats.n).toBe(3)
    expect(byTrial[0].stats.n).toBeGreaterThan(100)
  })

  it('averages within a rat before comparing groups', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    const lz039 = rows.filter((r) => r.values.animalId === 'LZ039')
    const collapsed = collapseToUnit(lz039, 'rewardLatency', 'subject')
    expect(collapsed).toHaveLength(1)

    const present = lz039
      .map((r) => r.values.rewardLatency)
      .filter((v): v is number => typeof v === 'number')
    expect(present).toHaveLength(67)
    expect(collapsed[0] as number).toBeCloseTo(present.reduce((a, b) => a + b, 0) / 67, 9)
  })

  it('scales binary variables to percentages exactly once', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const trialRows = buildTrialRows(dataset, registry, { includeCorrectionTrials: false })
    const sessionRows = buildSessionRows(dataset, registry, { includeCorrectionTrials: false })

    // 'correct' is 0/1 on trial rows and a proportion on session rows; both must come out
    // of `aggregate` on the same 0-100 scale.
    const fromTrials = aggregate(trialRows, 'correct', ['animalId'], 'trial', registry)
    const fromSessions = aggregate(sessionRows, 'correct', ['animalId'], 'session', registry)

    for (const cell of fromTrials) {
      const match = fromSessions.find((c) => c.group.id === cell.group.id)
      expect(match).toBeDefined()
      expect(cell.stats.mean as number).toBeCloseTo(match!.stats.mean as number, 6)
      expect(cell.stats.mean as number).toBeGreaterThan(1)
      expect(cell.stats.mean as number).toBeLessThanOrEqual(100)
    }
  })
})

describe('grouping', () => {
  it('orders separation distance numerically, not by first appearance', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const groups = groupBy(rows, ['distance'], registry)
    const values = groups.map((g) => g.key[0].value as number)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('labels coded values instead of showing raw numbers', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const groups = groupBy(rows, ['sampleSide'], registry)
    expect(groups.map((g) => g.label)).toEqual(['Left', 'Right'])
  })

  it('combines two grouping variables', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const groups = groupBy(rows, ['genotype', 'sampleSide'], registry)
    expect(groups.length).toBeGreaterThan(1)
    expect(groups[0].label).toMatch(/^(WT|AD) · (Left|Right)$/)
  })
})

describe('custom binning', () => {
  it('cuts a latency into the ranges the user asked for', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    // The user's example: 1-6 s, 7-12 s, then everything above.
    const spec = { variableKey: 'correctImageLatency', mode: 'custom' as const, binCount: 3, edges: [6, 12] }
    const result = computeBins(spec, rows, 's')

    expect(result.bins).toHaveLength(3)
    expect(result.bins.map((b) => b.label)).toEqual(['< 6 s', '6–12 s', '≥ 12 s'])
    // Outer bins are unbounded, so no value can fall outside.
    expect(result.excludedCount).toBe(0)

    // Half-open bins: a value exactly on a boundary goes to the upper bin, never both.
    expect(result.assign(5.999)).toBe(0)
    expect(result.assign(6)).toBe(1)
    expect(result.assign(12)).toBe(2)
    expect(result.assign(null)).toBeNull()
  })

  it('reports how many rows had no value to bin', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const result = computeBins(defaultBinSpec('rewardLatency'), rows, 's')

    // Trials with no reward have no latency; the count must be visible, not silently lost.
    const nulls = rows.filter((r) => r.values.rewardLatency === null).length
    expect(result.missingCount).toBe(nulls)
    expect(result.missingCount).toBeGreaterThan(0)
  })

  it('splits into quartiles of roughly equal size in equal-count mode', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const spec = defaultBinSpec('correctImageLatency')
    const result = computeBins(spec, rows, 's')
    const binned = applyBins(rows, spec, result)

    const counts = new Map<string, number>()
    for (const row of binned) {
      const label = row.values[binnedKey('correctImageLatency')]
      if (label === null) continue
      counts.set(String(label), (counts.get(String(label)) ?? 0) + 1)
    }
    expect(result.bins).toHaveLength(4)
    const sizes = [...counts.values()]
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(
      0.35 * Math.max(...sizes),
    )
  })

  it('becomes a grouping variable once binned', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const spec = { variableKey: 'correctImageLatency', mode: 'custom' as const, binCount: 3, edges: [6, 12] }
    const binned = applyBins(rows, spec, computeBins(spec, rows, 's'))

    // The point of the whole feature: latency range on the x-axis, accuracy on the y.
    const cells = aggregate(binned, 'correct', [binnedKey('correctImageLatency')], 'trial', registry)
    expect(cells.length).toBeGreaterThan(1)
    expect(cells.every((c) => c.stats.n > 0)).toBe(true)
    expect(cells.map((c) => c.group.label)).toContain('< 6 s')
  })

  it('collapses duplicate cut points rather than making empty bins', () => {
    const rows = Array.from({ length: 100 }, () => ({
      sessionIndex: 0,
      values: { x: 5 as number | null },
    }))
    const result = computeBins({ variableKey: 'x', mode: 'equal-count', binCount: 4, edges: [] }, rows)
    expect(result.bins).toHaveLength(1)
    expect(result.excludedCount).toBe(0)
  })
})

describe('binned group ordering', () => {
  it('orders ranges as defined, not alphabetically by label', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    const spec = {
      variableKey: 'correctImageLatency',
      mode: 'custom' as const,
      binCount: 3,
      edges: [6, 12],
    }
    const result = computeBins(spec, rows, 's')
    const binned = applyBins(rows, spec, result)
    const order = binLabelOrder(result)

    // Sorted as text, "≥ 12 s" comes before "6–12 s" — the axis would read out of order.
    const naive = aggregate(binned, 'correct', [binnedKey('correctImageLatency')], 'trial', registry)
    const ordered = aggregate(
      binned,
      'correct',
      [binnedKey('correctImageLatency')],
      'trial',
      registry,
      { [binnedKey('correctImageLatency')]: order },
    )

    expect(order).toEqual(['< 6 s', '6–12 s', '≥ 12 s'])
    expect(ordered.map((c) => c.group.label)).toEqual(order)
    expect(naive.map((c) => c.group.label)).not.toEqual(order)
  })

  it('drops rows it cannot bin instead of making an unlabelled group', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    const spec = defaultBinSpec('rewardLatency')
    const result = computeBins(spec, rows, 's')
    const binned = applyBins(rows, spec, result)

    // Trials with no reward have no latency; they must not become a category on the x-axis.
    expect(result.missingCount).toBeGreaterThan(0)
    expect(binned).toHaveLength(rows.length - result.missingCount)
    expect(binned.every((r) => r.values[binnedKey('rewardLatency')] !== null)).toBe(true)

    const cells = aggregate(binned, 'correct', [binnedKey('rewardLatency')], 'trial', registry, {
      [binnedKey('rewardLatency')]: binLabelOrder(result),
    })
    expect(cells.map((c) => c.group.label)).not.toContain('—')
  })
})
