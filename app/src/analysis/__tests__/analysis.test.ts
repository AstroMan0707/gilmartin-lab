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

/**
 * The three fixture sessions joined to Rat Info. `animalIds`, if given, overwrites each
 * file's Animal ID before parsing — the fixtures hold one session per rat, so this is how
 * a test gets two files for the same rat, or files that record no ID.
 */
async function loadDataset(animalIds?: string[]): Promise<Dataset> {
  const buf = readFileSync(join(FIXTURE_DIR, 'Rat Info.xlsx'))
  const { subjects } = await parseRatInfo(new Blob([new Uint8Array(buf)]))
  const parsed = FIXTURE_PAIRS.map((p, i) => {
    let xml = readFixture(p.xml)
    if (animalIds) {
      xml = xml.replace(/(<Name>Animal ID<\/Name>\s*<Value>)[^<]*/, `$1${animalIds[i]}`)
    }
    return parseSession(p.xml, xml)
  })
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
    for (const k of ['percentCorrect', 'correctTrials', 'rewardLatency', 'correctImageLatency', 'incorrectImageLatency']) {
      expect(keys.has(k), `missing DV ${k}`).toBe(true)
      expect(registry.byKey.get(k)?.role).toBe('DV')
    }
  })

  it('offers no duplicate accuracy or trial-count variables', async () => {
    const registry = buildRegistry(await loadDataset())
    const keys = new Set(registry.variables.map((v) => v.key))

    // Each of these reported the same numbers as a derived variable under a second name.
    for (const gone of ['correct', 'abetPercentCorrect', 'abetTrialsCompleted', 'abetAllAttempts']) {
      expect(keys.has(gone), `${gone} should no longer be offered`).toBe(false)
    }
    // No two measures may share a label, which is what made the picker ambiguous.
    const labels = registry.variables.map((v) => `${v.label}${v.unit ?? ''}`)
    expect(new Set(labels).size).toBe(labels.length)
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
    rows.forEach((row, i) => {
      // Checked against the machine's own End Summary, read straight from the parsed session.
      // Those markers are no longer offered as variables, but they remain the reference.
      const end = dataset.sessions[i].endSummary
      expect(row.values.percentCorrect as number).toBeCloseTo(
        end['End Summary - Percentage Correct'] as number,
        2,
      )
      expect(row.values.trialsAnalysed).toBe(end['End Summary - Trials Completed'])
      expect(row.values.correctTrials).toBe(
        dataset.sessions[i].trials.filter((t) => !t.isCorrectionTrial && t.correct === 1).length,
      )
      // Trials analysed plus corrections recovers ABET's total attempt count.
      expect(
        (row.values.trialsAnalysed as number) + (row.values.correctionTrialCount as number),
      ).toBe(end['End Summary - All Trials Completed'])
    })
  })

  it('counts correct trials as whole numbers, not a proportion', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildSessionRows(dataset, registry, { includeCorrectionTrials: false })

    const counts = rows.map((r) => r.values.correctTrials as number)
    expect(counts).toEqual([51, 59, 7])
    expect(counts.every((c) => Number.isInteger(c))).toBe(true)
    // The old bug: this variable held 0.75 rather than 51.
    expect(counts.every((c) => c > 1)).toBe(true)
  })

  it('scores correct correction trials as correct when they are included', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildSessionRows(dataset, registry, { includeCorrectionTrials: true })

    // First-attempt corrects (51, 59, 7) plus the correction attempts the rat got right
    // (16, 13, 7). Reading ABET's No. Correct, which is 0 on every correction attempt,
    // gave 51/99, 59/86 and 7/31 instead.
    expect(rows.map((r) => r.values.correctTrials)).toEqual([67, 72, 14])
    expect(rows.map((r) => r.values.percentCorrect as number)).toEqual([
      (67 / 99) * 100,
      (72 / 86) * 100,
      (14 / 31) * 100,
    ])

    // Trial rows must agree with session rows under the same setting.
    const trialRows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
    const correctOnTrialRows = trialRows.reduce((n, r) => n + (r.values.correctTrials as number), 0)
    expect(correctOnTrialRows).toBe(67 + 72 + 14)
  })

  it('keeps counting correction trials when they are excluded from analysis', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const excluded = buildSessionRows(dataset, registry, { includeCorrectionTrials: false })
    const included = buildSessionRows(dataset, registry, { includeCorrectionTrials: true })

    // Previously this read 0 whenever corrections were filtered out, which is the default.
    expect(excluded.map((r) => r.values.correctionTrialCount)).toEqual([31, 14, 17])
    expect(included.map((r) => r.values.correctionTrialCount)).toEqual([31, 14, 17])
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

  it('uses the sample SD, with an n − 1 denominator', () => {
    // Worked by hand: mean 2.5, squared deviations sum to 5, so SD = √(5/3) and
    // SEM = SD/√4. The population form, √(5/4) = 1.118, understates both.
    const stats = describeStats([1, 2, 3, 4])
    expect(stats.sd).toBeCloseTo(Math.sqrt(5 / 3), 12)
    expect(stats.sem).toBeCloseTo(Math.sqrt(5 / 3) / 2, 12)

    // n = 2: SD is |a − b| / √2.
    expect(describeStats([10, 20]).sd).toBeCloseTo(10 / Math.SQRT2, 12)
  })

  it('reports no error bar for a single observation', () => {
    // An SEM of 0 would draw a zero-length error bar, implying certainty from one rat.
    const stats = describeStats([5])
    expect(stats.n).toBe(1)
    expect(stats.sd).toBeNull()
    expect(stats.sem).toBeNull()
  })
})

describe('missing data points', () => {
  /*
   * Reward latencies for three rats:
   *   A: session 0 [2, —, 4], session 1 [—, 6]
   *   B: session 2 [—, —]         never collected a reward
   *   C: session 3 [3], session 4 [—]
   */
  const trial = (sessionIndex: number, subject: string, rewardLatency: number | null) => ({
    sessionIndex,
    values: { __sessionIndex: sessionIndex, __subjectKey: subject, rewardLatency },
  })
  const rows = [
    trial(0, 'A', 2), trial(0, 'A', null), trial(0, 'A', 4),
    trial(1, 'A', null), trial(1, 'A', 6),
    trial(2, 'B', null), trial(2, 'B', null),
    trial(3, 'C', 3),
    trial(4, 'C', null),
  ]

  it.each([
    // unit, n, missing — n + missing is always every data point of that kind.
    ['trial', 4, 5],
    ['session', 3, 2],
    ['subject', 2, 1],
  ] as const)('counts %s-level data points with no value as missing', async (unit, n, missing) => {
    // Missing used to read 0 for sessions and rats, and rat B vanished from n uncounted.
    const registry = buildRegistry(await loadDataset())
    const [cell] = aggregate(rows, 'rewardLatency', [], unit, registry)
    expect(cell.stats.n).toBe(n)
    expect(cell.stats.missing).toBe(missing)
  })

  it('leaves the missing rat out of the mean rather than counting it as zero', async () => {
    const registry = buildRegistry(await loadDataset())
    const [cell] = aggregate(rows, 'rewardLatency', [], 'subject', registry)
    // A is the mean of its session means (3 and 6); C's empty session does not count.
    expect(cell.stats.values.sort()).toEqual([3, 4.5])
    expect(cell.stats.mean).toBe(3.75)
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

  it('counts one rat once, however its ID is spelled', async () => {
    // The Rat Info join and session numbering already treat these as one rat; "Each rat"
    // used to see two, inflating n.
    const dataset = await loadDataset(['LZ039', 'lz 039', 'LZ122'])
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    expect(aggregate(rows, 'correctImageLatency', [], 'subject', registry)[0].stats.n).toBe(2)
    expect(groupBy(rows, ['animalId'], registry).map((g) => g.label)).toEqual(['LZ039', 'LZ122'])
  })

  it('treats each session without an ID as its own rat', async () => {
    // Two ID-less files are not evidence of one rat. They used to share an empty ID and
    // collapse into a single data point.
    const dataset = await loadDataset(['', '', 'LZ122'])
    const registry = buildRegistry(dataset)
    const rows = buildSessionRows(dataset, registry, { includeCorrectionTrials: false })

    expect(aggregate(rows, 'percentCorrect', [], 'subject', registry)[0].stats.n).toBe(3)
    expect(rows.map((r) => r.values.animalId)).toEqual([null, null, 'LZ122'])
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

  it('reports the same accuracy from trial rows and session rows', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const trialRows = buildTrialRows(dataset, registry, { includeCorrectionTrials: false })
    const sessionRows = buildSessionRows(dataset, registry, { includeCorrectionTrials: false })

    // Percent correct exists at both levels; the two paths must agree, and both must be on a
    // 0-100 scale rather than one of them being a 0-1 proportion.
    const fromTrials = aggregate(trialRows, 'percentCorrect', ['animalId'], 'trial', registry)
    const fromSessions = aggregate(sessionRows, 'percentCorrect', ['animalId'], 'session', registry)

    for (const cell of fromTrials) {
      const match = fromSessions.find((c) => c.group.id === cell.group.id)
      expect(match).toBeDefined()
      expect(cell.stats.mean as number).toBeCloseTo(match!.stats.mean as number, 6)
      expect(cell.stats.mean as number).toBeGreaterThan(1)
      expect(cell.stats.mean as number).toBeLessThanOrEqual(100)
    }
  })

  it('totals counts instead of averaging them', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const trialRows = buildTrialRows(dataset, registry, { includeCorrectionTrials: false })

    // Per rat, Correct Trials is the total number right — not the proportion right.
    const perRat = aggregate(trialRows, 'correctTrials', ['animalId'], 'subject', registry)
    const counts = perRat.map((c) => c.stats.mean as number).sort((a, b) => a - b)
    expect(counts).toEqual([7, 51, 59])
    expect(counts.every((c) => Number.isInteger(c))).toBe(true)

    // Percent correct over the same rows stays a rate, so the two are no longer the same number.
    const rate = aggregate(trialRows, 'percentCorrect', ['animalId'], 'subject', registry)
    for (const cell of rate) {
      const count = perRat.find((c) => c.group.id === cell.group.id)!
      expect(cell.stats.mean).not.toBeCloseTo(count.stats.mean as number, 6)
    }
  })

  it('averages rates but totals counts when several sessions collapse into one rat', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    // Two sessions attributed to the same rat, so collapsing has something to do.
    const rows = buildSessionRows(dataset, registry, { includeCorrectionTrials: false }).slice(0, 2)
    for (const r of rows) r.values.__subjectKey = 'SAME'

    const count = aggregate(rows, 'correctTrials', [], 'subject', registry)[0]
    const rate = aggregate(rows, 'percentCorrect', [], 'subject', registry)[0]

    expect(count.stats.mean).toBe(51 + 59)
    expect(rate.stats.mean as number).toBeCloseTo((75 + 81.94444444444444) / 2, 6)
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
    const cells = aggregate(binned, 'percentCorrect', [binnedKey('correctImageLatency')], 'trial', registry)
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
    const naive = aggregate(binned, 'percentCorrect', [binnedKey('correctImageLatency')], 'trial', registry)
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

    const cells = aggregate(binned, 'percentCorrect', [binnedKey('rewardLatency')], 'trial', registry, {
      [binnedKey('rewardLatency')]: binLabelOrder(result),
    })
    expect(cells.map((c) => c.group.label)).not.toContain('—')
  })
})

describe('touch counters', () => {
  /** Per-trial counter paired with the whole-session counter reporting the same thing. */
  const TOUCH_PAIRS = [
    ['leftItiTouches', 'sessionLeftItiTouches'],
    ['centreItiTouches', 'sessionCentreItiTouches'],
    ['rightItiTouches', 'sessionRightItiTouches'],
    ['leftBlankTouches', 'sessionLeftBlankTouches'],
    ['centreBlankTouches', 'sessionCentreBlankTouches'],
    ['rightBlankTouches', 'sessionRightBlankTouches'],
  ] as const

  it('keeps the whole-session counters, which are not the sum of the per-trial ones', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)

    // The reason these cannot be consolidated away: ABET tallies some touches session-wide
    // without attributing them to any trial, so the session figure exceeds the per-trial sum.
    // In example-input_1 that is 5 Left, 2 Centre and 3 Right blank touches.
    const session = dataset.sessions[0]
    const sumOf = (marker: string) =>
      session.trials.reduce((n, t) => n + (t.values[marker] ?? 0), 0)

    expect(sumOf('Trial Analysis - Left Blank Touches - Generic Counter')).toBe(123)
    expect(session.endSummary['End Summary - Left Blank Touches - Generic Counter']).toBe(128)
    expect(sumOf('Trial Analysis - Right Blank Touches - Generic Counter')).toBe(162)
    expect(session.endSummary['End Summary - Right Blank Touches - Generic Counter']).toBe(165)

    // Both halves of every pair must remain available, or those touches become unreachable.
    for (const [perTrial, wholeSession] of TOUCH_PAIRS) {
      expect(registry.byKey.has(perTrial), `${perTrial} missing`).toBe(true)
      expect(registry.byKey.has(wholeSession), `${wholeSession} missing`).toBe(true)
    }
  })

  it('shows only the per-trial counters by default, halving the picker', async () => {
    const registry = buildRegistry(await loadDataset())
    for (const [perTrial, wholeSession] of TOUCH_PAIRS) {
      expect(registry.byKey.get(perTrial)?.advanced ?? false).toBe(false)
      expect(registry.byKey.get(wholeSession)?.advanced).toBe(true)
    }
  })

  it('reports the number altogether as a Total, whatever the aggregation unit', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    // The total is a property of the data, not of how it is grouped into points.
    const perRat = aggregate(rows, 'leftBlankTouches', [], 'subject', registry)[0]
    const perTrial = aggregate(rows, 'leftBlankTouches', [], 'trial', registry)[0]
    expect(perRat.stats.total).toBe(123 + 78 + 41)
    expect(perTrial.stats.total).toBe(perRat.stats.total)

    // n still counts data points, so it changes with the unit while the total does not.
    expect(perRat.stats.n).toBe(3)
    expect(perTrial.stats.n).toBeGreaterThan(200)

    // The mean stays a per-trial rate, which is what makes it comparable across rats that
    // ran different numbers of trials.
    expect(perRat.stats.mean as number).toBeLessThan(5)
  })

  it('splits totals correctly across groups', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    const byGenotype = aggregate(rows, 'leftBlankTouches', ['genotype'], 'subject', registry)
    const summed = byGenotype.reduce((n, c) => n + (c.stats.total ?? 0), 0)
    expect(summed).toBe(123 + 78 + 41)
  })

  it('reports no total for rates and percentages, where one would be meaningless', async () => {
    const dataset = await loadDataset()
    const registry = buildRegistry(dataset)
    const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })

    expect(aggregate(rows, 'percentCorrect', [], 'subject', registry)[0].stats.total).toBeNull()
    expect(aggregate(rows, 'rewardLatency', [], 'subject', registry)[0].stats.total).toBeNull()
    // Counts do report one. Correction trials are included, so the correction attempts the
    // rats got right (16 + 13 + 7) count alongside the first-attempt corrects.
    expect(aggregate(rows, 'correctTrials', [], 'subject', registry)[0].stats.total).toBe(
      51 + 59 + 7 + 16 + 13 + 7,
    )
  })
})
