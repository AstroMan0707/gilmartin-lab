import writeXlsxFile from 'write-excel-file/universal'
import { deriveSessionSummary } from '../analysis/deriveSessionSummary'
import { filterTrials } from '../analysis/rows'
import type { Dataset, Session } from '../types'
import { buildFlatTable, type Cell } from './flatTable'

type SheetCell = { value?: string | number | Date | boolean; type?: unknown; format?: string; fontWeight?: string; align?: string } | null
type SheetRow = SheetCell[]

export interface WorkbookOptions {
  includeCorrectionTrials: boolean
  /** App version string, recorded on the Read Me sheet for provenance. */
  appVersion: string
}

const HEADER: Partial<NonNullable<SheetCell>> = { fontWeight: 'bold' }

function headerRow(columns: string[]): SheetRow {
  return columns.map((c) => ({ value: c, type: String, ...HEADER }))
}

/** Maps a parsed cell to a write-excel-file cell, preserving numbers as numbers. */
function cell(value: Cell): SheetCell {
  if (value === null || value === '') return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, type: Number } : null
  }
  return { value: String(value), type: String }
}

function textCell(value: string | null): SheetCell {
  return value === null || value === '' ? null : { value, type: String }
}

function numberCell(value: number | null, format?: string): SheetCell {
  return value === null || !Number.isFinite(value) ? null : { value, type: Number, format }
}

function dateCell(value: Date | null): SheetCell {
  return value === null ? null : { value, type: Date, format: 'yyyy-mm-dd' }
}

/** Column widths sized to the header text, so nothing arrives as `####`. */
function widthsFor(columns: string[]): { width: number }[] {
  return columns.map((c) => ({ width: Math.min(Math.max(c.length + 2, 10), 42) }))
}

/**
 * Sheet 1 — Trial Data: one row per trial attempt, all sessions stacked, in ABET's own
 * column order with subject metadata appended.
 *
 * Latency columns are time-aligned, so they differ from ABET's own CSV. The Read Me sheet
 * says so explicitly, because a user comparing the two files needs to know which is right.
 */
function trialDataSheet(dataset: Dataset, opts: WorkbookOptions) {
  const abet = buildFlatTable(dataset.sessions)

  const extraColumns = [
    'Attempt No.',
    'Is Correction Trial',
    'Correct',
    'Genotype',
    'Set',
    'Age at Test (days)',
    'Delay (s)',
    'Session Number',
    'Source File',
  ]
  const columns = [...abet.columns, ...extraColumns]

  // Row order matches buildFlatTable: sessions in load order, trials within each.
  const trialsByRow: { session: Session; trialIndex: number }[] = []
  for (const session of dataset.sessions) {
    const count = Math.max(session.trials.length, 1)
    for (let i = 0; i < count; i++) trialsByRow.push({ session, trialIndex: i })
  }

  const rows: SheetRow[] = [headerRow(columns)]

  abet.rows.forEach((abetRow, i) => {
    const { session, trialIndex } = trialsByRow[i]
    const trial = session.trials[trialIndex]

    // The correction-trial setting filters this sheet too, so the spreadsheet and the
    // figures always describe the same set of trials.
    if (trial && !opts.includeCorrectionTrials && trial.isCorrectionTrial) return

    rows.push([
      ...abetRow.map(cell),
      numberCell(trial?.attemptNo ?? null),
      textCell(trial ? (trial.isCorrectionTrial ? 'Yes' : 'No') : null),
      // ABET's own `No. Correct` column above is 0 on every correction attempt; this one
      // scores correction attempts too, and is what Percent Correct is computed from.
      numberCell(trial?.correct ?? null),
      textCell(session.genotype),
      numberCell(session.set),
      numberCell(session.ageDays),
      numberCell(session.delaySec),
      numberCell(session.sessionNumber),
      textCell(session.fileName),
    ])
  })

  return {
    sheet: 'Trial Data',
    data: rows,
    columns: widthsFor(columns),
    stickyRowsCount: 1,
  }
}

/** Sheet 2 — Session Summary: one row per session, ABET's figures beside our derived ones. */
function sessionSummarySheet(dataset: Dataset, opts: WorkbookOptions) {
  const endSummaryColumns: string[] = []
  for (const s of dataset.sessions) {
    for (const name of s.endSummaryOrder) {
      if (!endSummaryColumns.includes(name)) endSummaryColumns.push(name)
    }
  }

  const latencyColumns: string[] = []
  for (const s of dataset.sessions) {
    for (const col of s.trialColumnOrder) {
      if (col.endsWith('_Duration') && !latencyColumns.includes(col)) latencyColumns.push(col)
    }
  }

  const fixed = [
    'Animal ID',
    'Genotype',
    'Sex',
    'Set',
    'Age at Test (days)',
    'Test Day',
    'Session Number',
    'Schedule Name',
    'Delay (s)',
    'Chamber',
    'Schedule Run ID',
    'Trials Analysed',
    'Unique Trials',
    'Correction Trials',
    'Percent Correct (derived)',
  ]
  const meanLatencyHeaders = latencyColumns.map((c) => `Mean ${c.replace(/_Duration$/, '')} (s)`)
  const columns = [...fixed, ...meanLatencyHeaders, ...endSummaryColumns, 'Source File']

  const rows: SheetRow[] = [headerRow(columns)]

  for (const session of dataset.sessions) {
    const trials = filterTrials(session, opts)
    const summary = deriveSessionSummary(session, trials)

    rows.push([
      textCell(session.animalIdRaw || session.animalId),
      textCell(session.genotype),
      textCell(session.sex),
      numberCell(session.set),
      numberCell(session.ageDays),
      dateCell(session.testDay),
      numberCell(session.sessionNumber),
      textCell(session.scheduleName),
      numberCell(session.delaySec),
      textCell(session.chamber),
      textCell(session.scheduleRunId),
      numberCell(summary.nTrials),
      numberCell(summary.nTrialsUnique),
      numberCell(summary.nCorrectionTrials),
      numberCell(summary.percentCorrect, '0.000'),
      ...latencyColumns.map((c) => numberCell(summary.meanLatency[c] ?? null, '0.000')),
      ...endSummaryColumns.map((c) => numberCell(session.endSummary[c] ?? null)),
      textCell(session.fileName),
    ])
  }

  return {
    sheet: 'Session Summary',
    data: rows,
    columns: widthsFor(columns),
    stickyRowsCount: 1,
  }
}

/** Sheet 3 — Subjects: the Rat Info reference, with how many sessions matched each rat. */
function subjectsSheet(dataset: Dataset) {
  const columns = [
    'Rat ID (as written)',
    'Rat ID (matching key)',
    'Genotype',
    'Sex',
    'Birthday',
    'Set',
    'Sessions Loaded',
  ]
  const sessionCounts = new Map<string, number>()
  for (const s of dataset.sessions) {
    sessionCounts.set(s.animalId, (sessionCounts.get(s.animalId) ?? 0) + 1)
  }

  const rows: SheetRow[] = [headerRow(columns)]
  for (const subject of dataset.subjects) {
    rows.push([
      textCell(subject.ratIdRaw),
      textCell(subject.ratId),
      textCell(subject.genotype),
      textCell(subject.sex),
      dateCell(subject.birthday),
      numberCell(subject.set),
      numberCell(sessionCounts.get(subject.ratId) ?? 0),
    ])
  }

  return { sheet: 'Subjects', data: rows, columns: widthsFor(columns), stickyRowsCount: 1 }
}

/**
 * Sheet 4 — Read Me: provenance and the settings the export was made under.
 *
 * Present because this workbook's latency columns intentionally disagree with ABET's own
 * CSV. Anyone who opens the file months later, or receives it from a colleague, needs to
 * know that without having to ask.
 */
function readMeSheet(dataset: Dataset, opts: WorkbookOptions) {
  const rows: SheetRow[] = []
  const line = (label: string, value: string) => {
    rows.push([{ value: label, type: String, ...HEADER }, { value, type: String }])
  }
  const blank = () => rows.push([null, null])
  const para = (text: string) => rows.push([{ value: text, type: String }, null])

  rows.push([{ value: 'TUNL Parser export', type: String, ...HEADER }, null])
  blank()
  line('Exported', new Date().toISOString().replace('T', ' ').slice(0, 19))
  line('App version', opts.appVersion)
  line('Session files', String(dataset.xmlFileNames.length))
  line('Rat Info file', dataset.ratInfoFileName ?? '(none)')
  line('Subjects with data', String(new Set(dataset.sessions.map((s) => s.animalId)).size))
  line(
    'Correction trials',
    opts.includeCorrectionTrials
      ? 'Included — every attempt is a row, including repeats after an error.'
      : 'Excluded — first attempt at each trial only. This matches how ABET computes Percentage Correct.',
  )
  blank()

  rows.push([{ value: 'About the latency columns', type: String, ...HEADER }, null])
  para(
    'Latency values in this workbook are matched to the trial they actually occurred in, using each event\'s timestamp.',
  )
  para(
    "ABET's own CSV export lists latencies positionally instead: the first reward latency goes in row 1, the second in row 2, and so on.",
  )
  para(
    'Because a reward latency only exists for trials that earned a reward, that positional listing puts most values in the wrong row and leaves the last rows blank.',
  )
  para(
    'So the latency columns here will not match an ABET CSV of the same session. Every other column will.',
  )
  blank()

  rows.push([{ value: 'About the Correct column', type: String, ...HEADER }, null])
  para(
    "ABET's No. Correct column scores first attempts only: it is 0 on every correction trial, even one the rat got right.",
  )
  para(
    'The Correct column scores every attempt, using whether the correct image was touched. It matches No. Correct on every first attempt, and it is what Percent Correct is calculated from.',
  )
  blank()

  rows.push([{ value: 'Sheets in this workbook', type: String, ...HEADER }, null])
  line('Trial Data', 'One row per trial attempt, all sessions stacked, with subject metadata.')
  line('Session Summary', 'One row per session. Derived measures plus ABET\'s own End Summary values.')
  line('Subjects', 'The Rat Info reference file as it was read, with session counts.')
  blank()

  if (dataset.warnings.length > 0) {
    rows.push([{ value: 'Warnings raised when loading', type: String, ...HEADER }, null])
    for (const w of dataset.warnings) para(`• ${w.message}`)
    blank()
  }

  rows.push([{ value: 'Source files', type: String, ...HEADER }, null])
  for (const name of dataset.xmlFileNames) para(name)

  return { sheet: 'Read Me', data: rows, columns: [{ width: 26 }, { width: 110 }] }
}

/**
 * Builds the multi-sheet export workbook.
 *
 * Returns a Blob so the caller can download it. Nothing is uploaded anywhere — the whole
 * workbook is assembled in the browser.
 */
export async function buildWorkbook(dataset: Dataset, opts: WorkbookOptions): Promise<Blob> {
  if (dataset.sessions.length === 0) {
    throw new Error('There is no data to export. Load some session files first.')
  }

  const sheets = [
    trialDataSheet(dataset, opts),
    sessionSummarySheet(dataset, opts),
    subjectsSheet(dataset),
    readMeSheet(dataset, opts),
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the writer's Sheet type is generic over its file-content type
  return (await writeXlsxFile(sheets as any, { fontFamily: 'Calibri', fontSize: 11 })).toBlob()
}

/** Default filename, dated so successive exports do not overwrite each other. */
export function workbookFileName(dataset: Dataset): string {
  const date = new Date().toISOString().slice(0, 10)
  const n = dataset.sessions.length
  return `TUNL_data_${n}_session${n === 1 ? '' : 's'}_${date}.xlsx`
}
