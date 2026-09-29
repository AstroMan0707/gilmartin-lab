import { describe, expect, it } from 'vitest'
import { buildFlatTable } from '../../export/flatTable'
import { parseSession } from '../parseSession'
import { FIXTURE_PAIRS, parseCsv, readFixture } from './fixtures'

/** Column names whose placement we deliberately fix, so they must NOT match ABET's CSV. */
const LATENCY_COLUMNS = [
  'Trial Analysis - Reward Collection Latency_Duration',
  'Trial Analysis - Reward Collection Latency_Counts',
  'Trial Analysis - Correct Image Response Latency_Duration',
  'Trial Analysis - Correct Image Response Latency_Counts',
  'Trial Analysis - Incorrect Image Latency_Duration',
  'Trial Analysis - Incorrect Image Latency_Counts',
]

/** Compares a parsed cell with a CSV cell, numerically where both are numeric. */
function cellsMatch(ours: number | string | null, theirs: string): boolean {
  const t = theirs.trim()
  if (ours === null || ours === '') return t === ''
  if (t === '') return false
  if (typeof ours === 'number') {
    const n = Number(t)
    // ABET prints 2.69 for 2.690; compare as numbers, with a tolerance well below the
    // 1 ms resolution of the source data.
    return Number.isFinite(n) && Math.abs(n - ours) < 1e-9
  }
  return String(ours).trim() === t
}

describe.each(FIXTURE_PAIRS)('parser fidelity: $xml', ({ xml, csv, animalId, trials }) => {
  const session = parseSession(xml, readFixture(xml))
  const reference = parseCsv(readFixture(csv))
  const table = buildFlatTable([session])

  it('identifies the session', () => {
    expect(session.animalId).toBe(animalId)
    expect(session.trials).toHaveLength(trials)
  })

  it('produces the same columns, in the same order, as ABET', () => {
    expect(table.columns).toEqual(reference.header)
  })

  it('produces one row per trial attempt, matching ABET', () => {
    expect(table.rows).toHaveLength(reference.rows.length)
    expect(table.rows).toHaveLength(trials)
  })

  it('matches ABET cell-for-cell on every non-latency column', () => {
    const mismatches: string[] = []
    table.columns.forEach((col, c) => {
      if (LATENCY_COLUMNS.includes(col)) return
      for (let r = 0; r < table.rows.length; r++) {
        const ours = table.rows[r][c]
        const theirs = reference.rows[r][c]
        if (!cellsMatch(ours, theirs)) {
          mismatches.push(`row ${r + 1} "${col}": ours=${JSON.stringify(ours)} abet=${JSON.stringify(theirs)}`)
        }
      }
    })
    expect(mismatches).toEqual([])
  })

  it('reports no unattributable latency events', () => {
    expect(session.alignmentWarnings.filter((w) => w.reason === 'collision')).toEqual([])
  })
})

describe('latency alignment', () => {
  const session = parseSession('example-input_1.xml', readFixture('example-input_1.xml'))
  const dur = (name: string) =>
    session.trials.map((t) => t.values[`Trial Analysis - ${name}_Duration`])

  const reward = dur('Reward Collection Latency')
  const correctImage = dur('Correct Image Response Latency')
  const incorrectImage = dur('Incorrect Image Latency')
  const present = (a: (number | null)[]) => a.filter((v) => v !== null).length

  it('keeps every event and assigns each to exactly one trial', () => {
    // The XML holds 67 reward, 67 correct-image and 32 incorrect-image events.
    expect(present(reward)).toBe(67)
    expect(present(correctImage)).toBe(67)
    expect(present(incorrectImage)).toBe(32)
    expect(session.alignmentWarnings).toEqual([])
  })

  it('partitions all 99 trials into rewarded and unrewarded', () => {
    // Every trial has either a correct-image response (and a reward) or an incorrect-image
    // response, never both and never neither. This is what makes the alignment provably
    // right rather than merely plausible.
    for (let i = 0; i < session.trials.length; i++) {
      const rewarded = correctImage[i] !== null
      const missed = incorrectImage[i] !== null
      expect(rewarded !== missed).toBe(true)
      expect(reward[i] !== null).toBe(rewarded)
    }
    expect(present(correctImage) + present(incorrectImage)).toBe(99)
  })

  it('places reward latencies with the trial that earned them, not by position', () => {
    // The regression this whole app exists to prevent. ABET's CSV puts the second reward
    // latency (1.863 s, recorded at t=187.5 s) in row 2; it belongs to the trial ending at
    // 210.088 s, which is row 5. Row 2 in truth has no reward at all.
    expect(reward[0]).toBe(1.633)
    expect(reward[1]).toBeNull()
    expect(reward[4]).toBe(1.863)

    // Likewise trial 1 was correct, so ABET's incorrect-image latency of 2.857 s in row 1
    // is spurious; the value belongs to the first error trial, row 2.
    expect(incorrectImage[0]).toBeNull()
    expect(incorrectImage[1]).toBe(2.857)
  })

  it('leaves missing latencies null rather than zero', () => {
    // A trial with no reward must not contribute a 0 s reward latency to any mean.
    expect(reward.some((v) => v === 0)).toBe(false)
    expect(reward[1]).toBeNull()
  })

  it('differs from ABET only on the latency columns', () => {
    const reference = parseCsv(readFixture('example-output_1.csv'))
    const table = buildFlatTable([session])
    const changed = new Set<string>()
    table.columns.forEach((col, c) => {
      for (let r = 0; r < table.rows.length; r++) {
        if (!cellsMatch(table.rows[r][c], reference.rows[r][c])) changed.add(col)
      }
    })
    expect([...changed].sort()).toEqual([...LATENCY_COLUMNS].sort())
  })
})

describe('correction trials', () => {
  it.each(FIXTURE_PAIRS)('reproduces ABET\'s own summary for $xml', ({ xml }) => {
    const session = parseSession(xml, readFixture(xml))

    // First attempts only: ABET's Trial No. repeats while the rat retries a trial.
    const firstAttempts = session.trials.filter((t) => !t.isCorrectionTrial)
    const distinctTrialNos = new Set(session.trials.map((t) => t.trialNo))
    expect(firstAttempts).toHaveLength(distinctTrialNos.size)

    // The machine's own numbers are the independent check on our correction-trial logic.
    const completed = session.endSummary['End Summary - Trials Completed']
    const percentCorrect = session.endSummary['End Summary - Percentage Correct']
    expect(firstAttempts).toHaveLength(completed as number)

    // ABET reports the unrounded percentage to three decimals (81.944, not 82), so
    // compare at that resolution rather than rounding to an integer.
    const correct = firstAttempts.filter((t) => t.correct === 1).length
    const ours = (correct / firstAttempts.length) * 100
    expect(ours).toBeCloseTo(percentCorrect as number, 2)
  })

  it.each(FIXTURE_PAIRS)('scores every attempt by the response actually made in $xml', ({ xml }) => {
    const session = parseSession(xml, readFixture(xml))
    // A correct-image touch is the ground truth for "correct" on any attempt; ABET's
    // No. Correct only agrees with it on first attempts.
    for (const t of session.trials) {
      const touchedCorrect =
        t.values['Trial Analysis - Correct Image Response Latency_Duration'] !== null
      expect(t.correct).toBe(touchedCorrect ? 1 : 0)
    }
  })

  it('counts the correction attempt that finally succeeds as correct', () => {
    const session = parseSession('example-input_1.xml', readFixture('example-input_1.xml'))
    const trial2 = session.trials.filter((t) => t.trialNo === 2)
    // Wrong three times, then right. ABET's No. Correct reads 0 on all four attempts.
    expect(trial2.map((t) => t.correct)).toEqual([0, 0, 0, 1])
    expect(trial2.map((t) => t.values['Trial Analysis - No. Correct'])).toEqual([0, 0, 0, 0])
  })

  it('numbers repeat attempts in order', () => {
    const session = parseSession('example-input_1.xml', readFixture('example-input_1.xml'))
    const trial2 = session.trials.filter((t) => t.trialNo === 2)
    expect(trial2.map((t) => t.attemptNo)).toEqual([1, 2, 3, 4])
    expect(trial2.map((t) => t.isCorrectionTrial)).toEqual([false, true, true, true])
    // 99 attempts across 68 distinct trials.
    expect(session.trials).toHaveLength(99)
    expect(new Set(session.trials.map((t) => t.trialNo)).size).toBe(68)
  })
})

describe('session metadata', () => {
  it('extracts the fields needed to join and order sessions', () => {
    const s = parseSession('example-input_1.xml', readFixture('example-input_1.xml'))
    expect(s.animalIdRaw).toBe('LZ039')
    expect(s.sexXml).toBe('F')
    expect(s.scheduleName).toBe('Rat TUNL Full v2 0s')
    expect(s.delaySec).toBe(0)
    expect(s.chamber).toBe('Chamber2 [2]')
    expect(s.testDay?.toISOString().slice(0, 10)).toBe('2026-07-14')
  })

  it('recovers the 20 s delay condition from the schedule name', () => {
    const s = parseSession('example-output_3.xml', readFixture('example-output_3.xml'))
    expect(s.scheduleName).toBe('Rat TUNL Full v2 20s')
    expect(s.delaySec).toBe(20)
  })

  it('rejects files that are not ABET exports', () => {
    expect(() => parseSession('x.xml', '<html><body>nope</body></html>')).toThrow(/LiEvent/)
    expect(() => parseSession('x.xml', 'not xml at all <<<')).toThrow()
  })
})
