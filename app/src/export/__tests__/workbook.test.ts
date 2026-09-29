import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/universal'
import { beforeAll, describe, expect, it } from 'vitest'
import { joinMetadata } from '../../parse/joinMetadata'
import { parseRatInfo } from '../../parse/parseRatInfo'
import { parseSession } from '../../parse/parseSession'
import { FIXTURE_DIR, FIXTURE_PAIRS, readFixture } from '../../parse/__tests__/fixtures'
import type { Dataset } from '../../types'
import { buildWorkbook, workbookFileName } from '../workbook'

let dataset: Dataset

beforeAll(async () => {
  const buf = readFileSync(join(FIXTURE_DIR, 'Rat Info.xlsx'))
  const { subjects } = await parseRatInfo(new Blob([new Uint8Array(buf)]))
  const parsed = FIXTURE_PAIRS.map((p) => parseSession(p.xml, readFixture(p.xml)))
  const { sessions, warnings } = joinMetadata(parsed, subjects)
  dataset = {
    sessions,
    subjects,
    warnings,
    loadedAt: new Date(0),
    xmlFileNames: FIXTURE_PAIRS.map((p) => p.xml),
    ratInfoFileName: 'Rat Info.xlsx',
  }
})

type Sheets = { sheet: string; data: unknown[][] }[]

async function roundTrip(includeCorrectionTrials: boolean): Promise<Sheets> {
  const blob = await buildWorkbook(dataset, { includeCorrectionTrials, appVersion: 'test' })
  const buf = await blob.arrayBuffer()
  return (await readXlsxFile(new Blob([buf]))) as unknown as Sheets
}

function sheetByName(sheets: Sheets, name: string): unknown[][] {
  const found = sheets.find((s) => s.sheet === name)
  expect(found, `sheet "${name}" is missing`).toBeDefined()
  return found!.data
}

describe('workbook export', () => {
  it('writes the four expected sheets', async () => {
    const sheets = await roundTrip(false)
    expect(sheets.map((s) => s.sheet)).toEqual([
      'Trial Data',
      'Session Summary',
      'Subjects',
      'Read Me',
    ])
  })

  it('stacks every session into Trial Data and honours the correction-trial setting', async () => {
    const withCorrections = sheetByName(await roundTrip(true), 'Trial Data')
    const without = sheetByName(await roundTrip(false), 'Trial Data')

    // 99 + 86 + 31 attempts, plus a header row.
    expect(withCorrections).toHaveLength(99 + 86 + 31 + 1)
    expect(without.length).toBeLessThan(withCorrections.length)

    // First attempts only: 68 + 72 + ... unique trials, which is what ABET counted.
    const expected = dataset.sessions.reduce(
      (n, s) => n + s.trials.filter((t) => !t.isCorrectionTrial).length,
      0,
    )
    expect(without).toHaveLength(expected + 1)
  })

  it('keeps ABET column order and appends the joined metadata', async () => {
    const rows = sheetByName(await roundTrip(false), 'Trial Data')
    const header = rows[0].map(String)

    expect(header[0]).toBe('Database')
    expect(header).toContain('Trial Analysis - Reward Collection Latency_Duration')
    // Metadata is appended after ABET's own columns, not interleaved.
    expect(header.slice(-9)).toEqual([
      'Attempt No.',
      'Is Correction Trial',
      'Correct',
      'Genotype',
      'Set',
      'Age at Test (days)',
      'Delay (s)',
      'Session Number',
      'Source File',
    ])
  })

  it('leaves absent latencies genuinely empty, not zero', async () => {
    const rows = sheetByName(await roundTrip(true), 'Trial Data')
    const header = rows[0].map(String)
    const col = header.indexOf('Trial Analysis - Reward Collection Latency_Duration')
    expect(col).toBeGreaterThan(-1)

    const body = rows.slice(1)
    const values = body.map((r) => r[col])
    const empty = values.filter((v) => v === null || v === undefined || v === '')
    const zeros = values.filter((v) => v === 0)

    // A trial with no reward has no latency. Writing 0 would silently drag every mean down.
    expect(empty.length).toBeGreaterThan(0)
    expect(zeros).toHaveLength(0)

    // Numbers survive as numbers, not text, so Excel can average them.
    const numeric = values.filter((v) => typeof v === 'number')
    expect(numeric.length).toBeGreaterThan(0)
  })

  it('gives one Session Summary row per session, agreeing with ABET', async () => {
    const rows = sheetByName(await roundTrip(false), 'Session Summary')
    const header = rows[0].map(String)
    expect(rows).toHaveLength(dataset.sessions.length + 1)

    const derived = header.indexOf('Percent Correct (derived)')
    const abet = header.indexOf('End Summary - Percentage Correct')
    const analysed = header.indexOf('Trials Analysed')
    const abetCompleted = header.indexOf('End Summary - Trials Completed')

    for (const row of rows.slice(1)) {
      expect(row[derived] as number).toBeCloseTo(row[abet] as number, 2)
      expect(row[analysed]).toBe(row[abetCompleted])
    }
  })

  it('scores correct correction trials as correct in both sheets', async () => {
    const sheets = await roundTrip(true)
    const trials = sheetByName(sheets, 'Trial Data')
    const correctCol = trials[0].map(String).indexOf('Correct')
    const totalCorrect = trials.slice(1).reduce((n, r) => n + (r[correctCol] as number), 0)
    // 51 + 59 + 7 first-attempt corrects, plus 16 + 13 + 7 correct correction attempts.
    expect(totalCorrect).toBe(67 + 72 + 14)

    const summary = sheetByName(sheets, 'Session Summary')
    const derived = summary[0].map(String).indexOf('Percent Correct (derived)')
    expect(summary.slice(1).map((r) => r[derived] as number)).toEqual(
      [(67 / 99) * 100, (72 / 86) * 100, (14 / 31) * 100].map((v) => expect.closeTo(v, 6)),
    )
  })

  it('counts correction trials in Session Summary whatever the setting', async () => {
    for (const include of [false, true]) {
      const rows = sheetByName(await roundTrip(include), 'Session Summary')
      const col = rows[0].map(String).indexOf('Correction Trials')
      // The playground's Correction Trials measure reports the same 31, 14 and 17.
      expect(rows.slice(1).map((r) => r[col])).toEqual([31, 14, 17])
    }
  })

  it('carries genotype, age and delay onto every session row', async () => {
    const rows = sheetByName(await roundTrip(false), 'Session Summary')
    const header = rows[0].map(String)
    const genotype = header.indexOf('Genotype')
    const age = header.indexOf('Age at Test (days)')
    const delay = header.indexOf('Delay (s)')

    for (const row of rows.slice(1)) {
      expect(['WT', 'AD']).toContain(row[genotype])
      expect(row[age] as number).toBeGreaterThan(0)
      expect([0, 20]).toContain(row[delay])
    }
  })

  it('lists all 48 rats with their session counts', async () => {
    const rows = sheetByName(await roundTrip(false), 'Subjects')
    expect(rows).toHaveLength(49)

    const header = rows[0].map(String)
    const idCol = header.indexOf('Rat ID (as written)')
    const keyCol = header.indexOf('Rat ID (matching key)')
    const loadedCol = header.indexOf('Sessions Loaded')

    const lz039 = rows.slice(1).find((r) => r[keyCol] === 'LZ039')
    expect(lz039).toBeDefined()
    // Shows both spellings, so a user can see why a join did or did not happen.
    expect(lz039![idCol]).toBe('LZ 039')
    expect(lz039![loadedCol]).toBe(1)

    const loadedTotal = rows.slice(1).reduce((n, r) => n + (r[loadedCol] as number), 0)
    expect(loadedTotal).toBe(dataset.sessions.length)
  })

  it('records the latency fix and the settings used on the Read Me sheet', async () => {
    const rows = sheetByName(await roundTrip(false), 'Read Me')
    const text = rows.flat().filter((c) => typeof c === 'string').join('\n')

    expect(text).toContain('Correction trials')
    expect(text).toContain('Excluded')
    // Anyone comparing this file with an ABET CSV must be told which is right and why.
    expect(text).toContain('will not match an ABET CSV')
    expect(text).toContain('Rat Info.xlsx')
    for (const p of FIXTURE_PAIRS) expect(text).toContain(p.xml)
  })

  it('names the file after the session count and date', () => {
    expect(workbookFileName(dataset)).toMatch(/^TUNL_data_3_sessions_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('refuses to export an empty dataset with a clear message', async () => {
    await expect(
      buildWorkbook({ ...dataset, sessions: [] }, { includeCorrectionTrials: false, appVersion: 't' }),
    ).rejects.toThrow(/no data to export/i)
  })
})
