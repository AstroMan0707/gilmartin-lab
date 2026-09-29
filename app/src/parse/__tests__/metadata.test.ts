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

  describe('sex', () => {
    /** LZ039's session, relabelled: Rat Info records LZ039 as female. */
    function session(fileName: string, sexXml: 'F' | 'M' | null, animalId = 'LZ039') {
      const s = parseSession(fileName, readFixture('example-input_1.xml'))
      ;(s as { sexXml: 'F' | 'M' | null }).sexXml = sexXml
      ;(s as { animalId: string }).animalId = animalId
      ;(s as { animalIdRaw: string }).animalIdRaw = animalId
      ;(s as { scheduleRunId: string }).scheduleRunId = fileName
      return s
    }

    it('takes Rat Info over the session file, and says so', async () => {
      const { subjects } = await parseRatInfo(ratInfoBlob())
      const { sessions, warnings } = joinMetadata([session('a.xml', 'M')], subjects)
      expect(sessions[0].sex).toBe('F')
      expect(warnings.find((w) => w.kind === 'sex-conflict')?.message).toContain('Rat Info is used')
    })

    it('gives a rat one sex even when its session files disagree', async () => {
      // One session typed "male" used to put LZ039 in both sex groups, counting it twice.
      const { subjects } = await parseRatInfo(ratInfoBlob())
      const { sessions } = joinMetadata(
        [session('a.xml', 'F'), session('b.xml', 'M'), session('c.xml', null)],
        subjects,
      )
      expect(sessions.map((s) => s.sex)).toEqual(['F', 'F', 'F'])
    })

    it('falls back to the session files for a rat Rat Info lacks, if they agree', async () => {
      const { subjects } = await parseRatInfo(ratInfoBlob())
      const { sessions, warnings } = joinMetadata(
        [session('a.xml', 'M', 'ZZ999'), session('b.xml', null, 'ZZ999')],
        subjects,
      )
      // The session with no Sex field takes the rat's sex from its other session.
      expect(sessions.map((s) => s.sex)).toEqual(['M', 'M'])
      expect(warnings.find((w) => w.kind === 'sex-conflict')).toBeUndefined()
    })

    it('leaves sex blank rather than guessing when those session files disagree', async () => {
      const { subjects } = await parseRatInfo(ratInfoBlob())
      const { sessions, warnings } = joinMetadata(
        [session('a.xml', 'M', 'ZZ999'), session('b.xml', 'F', 'ZZ999')],
        subjects,
      )
      expect(sessions.map((s) => s.sex)).toEqual([null, null])
      const warning = warnings.find((w) => w.kind === 'sex-conflict')
      expect(warning?.subjects).toEqual(['ZZ999'])
      expect(warning?.message).toContain('disagree on the sex of ZZ999')
    })
  })

  it('names the files that record no Animal ID, rather than quoting an empty ID', async () => {
    const { subjects } = await parseRatInfo(ratInfoBlob())
    const noId = parseSession('no-id.xml', readFixture('example-input_1.xml'))
    ;(noId as { animalId: string }).animalId = ''
    ;(noId as { animalIdRaw: string }).animalIdRaw = ''
    const { warnings } = joinMetadata([noId], subjects)
    const warning = warnings.find((w) => w.kind === 'unmatched-animal')
    expect(warning?.message).toContain('record no Animal ID')
    expect(warning?.message).toContain('no-id.xml')
    expect(warning?.message).not.toContain('""')
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
