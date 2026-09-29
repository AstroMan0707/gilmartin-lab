import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveSessionSummary } from '../../analysis/deriveSessionSummary'
import { joinMetadata } from '../joinMetadata'
import { excelSerialToDate, parseRatInfo } from '../parseRatInfo'
import { normalizeAnimalId, normalizeSex, parseSession, parseTestDay } from '../parseSession'
import { FIXTURE_DIR, FIXTURE_PAIRS, readFixture } from './fixtures'

function ratInfoBlob(): Blob {
  const buf = readFileSync(join(FIXTURE_DIR, 'Rat Info.xlsx'))
  return new Blob([new Uint8Array(buf)])
}

describe('id normalization', () => {
  it('makes the two spellings of a rat ID meet', () => {
    // The whole join hinges on this: XML writes LZ039, the spreadsheet writes "LZ 039".
    expect(normalizeAnimalId('LZ 039')).toBe(normalizeAnimalId('LZ039'))
    expect(normalizeAnimalId(' lz 039 ')).toBe('LZ039')
    // Row 25 of the real spreadsheet is "LZ127" with no space, unlike its 47 neighbours.
    expect(normalizeAnimalId('LZ127')).toBe('LZ127')
  })

  it('normalizes the two sex spellings', () => {
    expect(normalizeSex('female')).toBe('F')
    expect(normalizeSex('F')).toBe('F')
    expect(normalizeSex('male')).toBe('M')
    expect(normalizeSex('unknown')).toBeNull()
    expect(normalizeSex(undefined)).toBeNull()
  })

  it('reads US-style test dates without locale ambiguity', () => {
    expect(parseTestDay('7/14/2026')?.toISOString().slice(0, 10)).toBe('2026-07-14')
    // 4 March, not 3 April: month comes first in ABET's format.
    expect(parseTestDay('3/4/2026')?.toISOString().slice(0, 10)).toBe('2026-03-04')
    expect(parseTestDay('2026-07-14T10:39:36.445')?.toISOString().slice(0, 10)).toBe('2026-07-14')
    expect(parseTestDay('')).toBeNull()
  })
})

describe('excel serial dates', () => {
  it('converts the Birthday column, which is stored as a bare number', () => {
    expect(excelSerialToDate(45643).toISOString().slice(0, 10)).toBe('2024-12-17')
    expect(excelSerialToDate(45598).toISOString().slice(0, 10)).toBe('2024-11-02')
  })
})

describe('Rat Info.xlsx', () => {
  it('reads all 48 rats despite trailing spaces in the headers', async () => {
    const { subjects, problems } = await parseRatInfo(ratInfoBlob())
    expect(subjects).toHaveLength(48)
    expect(problems).toEqual([])

    const lz039 = subjects.find((s) => s.ratId === 'LZ039')
    expect(lz039).toBeDefined()
    expect(lz039?.ratIdRaw).toBe('LZ 039')
    expect(lz039?.genotype).toBe('WT')
    expect(lz039?.sex).toBe('F')
    expect(lz039?.set).toBe(1)
    expect(lz039?.birthday?.toISOString().slice(0, 10)).toBe('2024-11-02')
  })

  it('finds every genotype and set level', async () => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    expect(new Set(subjects.map((s) => s.genotype))).toEqual(new Set(['WT', 'AD']))
    expect(new Set(subjects.map((s) => s.set))).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(subjects.every((s) => s.birthday !== null)).toBe(true)
  })
})

describe('joining sessions to subjects', () => {
  it('attaches genotype, set and age to every fixture session', async () => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    const parsed = FIXTURE_PAIRS.map((p) => parseSession(p.xml, readFixture(p.xml)))
    const { sessions, warnings } = joinMetadata(parsed, subjects)

    expect(sessions).toHaveLength(3)
    for (const s of sessions) {
      expect(s.subject).not.toBeNull()
      expect(s.genotype).toMatch(/^(WT|AD)$/)
      expect(s.set).toBeGreaterThan(0)
      expect(s.ageDays).toBeGreaterThan(0)
    }

    // LZ039 was born 2024-11-02 and tested 2026-07-14.
    const lz039 = sessions.find((s) => s.animalId === 'LZ039')
    expect(lz039?.genotype).toBe('WT')
    expect(lz039?.ageDays).toBe(619)
    expect(lz039?.sex).toBe('F')

    // Every rat matched, so no unmatched warning; the unused-subject note is expected
    // because only 3 of 48 rats have sessions loaded.
    expect(warnings.map((w) => w.kind)).not.toContain('unmatched-animal')
    expect(warnings.map((w) => w.kind)).toContain('unused-subject')
  })

  it('numbers each subject\'s sessions independently, in date order', async () => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    const one = parseSession('a.xml', readFixture('example-input_1.xml'))
    // Same rat, a later date: should become session 2 regardless of load order.
    const later = parseSession('b.xml', readFixture('example-input_1.xml'))
    ;(later as { testDay: Date | null }).testDay = new Date(Date.UTC(2026, 6, 20))
    ;(later as { scheduleRunId: string }).scheduleRunId = '999'

    const { sessions } = joinMetadata([later, one], subjects)
    const byFile = new Map(sessions.map((s) => [s.fileName, s]))
    expect(byFile.get('a.xml')?.sessionNumber).toBe(1)
    expect(byFile.get('b.xml')?.sessionNumber).toBe(2)
  })

  it('warns but still includes a rat missing from Rat Info', async () => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    const orphan = parseSession('orphan.xml', readFixture('example-input_1.xml'))
    ;(orphan as { animalId: string }).animalId = 'ZZ999'
    ;(orphan as { animalIdRaw: string }).animalIdRaw = 'ZZ999'

    const { sessions, warnings } = joinMetadata([orphan], subjects)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].genotype).toBeNull()
    expect(sessions[0].ageDays).toBeNull()
    // Its trials survive, so the user can still analyse the session.
    expect(sessions[0].trials).toHaveLength(99)
    expect(warnings.find((w) => w.kind === 'unmatched-animal')?.message).toContain('ZZ999')
  })

  it('flags the same run loaded twice', async () => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    const a = parseSession('copy-a.xml', readFixture('example-input_1.xml'))
    const b = parseSession('copy-b.xml', readFixture('example-input_1.xml'))
    const { warnings } = joinMetadata([a, b], subjects)
    expect(warnings.find((w) => w.kind === 'duplicate-session')?.files).toEqual([
      'copy-a.xml',
      'copy-b.xml',
    ])
  })
})

describe('derived session summary', () => {
  it.each(FIXTURE_PAIRS)('matches ABET\'s own end-of-session figures for $xml', async ({ xml }) => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    const { sessions } = joinMetadata([parseSession(xml, readFixture(xml))], subjects)
    const session = sessions[0]

    const firstAttempts = session.trials.filter((t) => !t.isCorrectionTrial)
    const summary = deriveSessionSummary(session, firstAttempts)

    expect(summary.nTrials).toBe(session.endSummary['End Summary - Trials Completed'])
    expect(summary.percentCorrect).toBeCloseTo(
      session.endSummary['End Summary - Percentage Correct'] as number,
      2,
    )
    // Counted from the whole session, so it survives the filter above; with the default
    // setting this column used to read 0 for every session.
    expect(summary.nCorrectionTrials).toBe(session.trials.length - firstAttempts.length)
    expect(summary.nCorrectionTrials).toBeGreaterThan(0)

    // Accuracy per distance must agree with the End Summary counters, which are correct
    // counts per distance over first attempts.
    for (const [distance, pct] of Object.entries(summary.percentCorrectByDistance)) {
      const n = firstAttempts.filter(
        (t) => t.values['Trial Analysis - Distance gp'] === Number(distance),
      ).length
      const ourCorrect = Math.round((pct / 100) * n)
      const abet = session.endSummary[
        Object.keys(session.endSummary).find((k) =>
          k.startsWith(`End Summary - Corrects at Distance ${distance} -`),
        ) ?? ''
      ]
      expect(ourCorrect).toBe(abet)
    }
  })

  it('averages latencies only over trials where the event happened', async () => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    const { sessions } = joinMetadata(
      [parseSession('example-input_1.xml', readFixture('example-input_1.xml'))],
      subjects,
    )
    const summary = deriveSessionSummary(sessions[0], sessions[0].trials)
    const col = 'Trial Analysis - Reward Collection Latency_Duration'
    const present = sessions[0].trials.map((t) => t.values[col]).filter((v): v is number => v !== null)

    expect(present).toHaveLength(67)
    expect(summary.meanLatency[col]).toBeCloseTo(
      present.reduce((a, b) => a + b, 0) / 67,
      6,
    )
    // Averaging over all 99 trials instead would give a visibly smaller number; confirm we
    // are not doing that.
    expect(summary.meanLatency[col]).not.toBeCloseTo(
      present.reduce((a, b) => a + b, 0) / 99,
      3,
    )
  })
})
