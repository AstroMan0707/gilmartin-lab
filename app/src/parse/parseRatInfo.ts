// The `universal` entry accepts a Blob and works unchanged in the browser, inside a Web
// Worker, and under Node in the test suite. The package has no root export.
import readXlsxFile from 'read-excel-file/universal'
import type { SubjectInfo } from '../types'
import { normalizeAnimalId, normalizeSex } from './parseSession'

/** Excel's day-zero for the 1900 date system. Day 1 is 1900-01-01. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

/**
 * Converts an Excel serial date to a UTC Date.
 *
 * Needed because the lab's Birthday column is stored as a bare number (45643) with no date
 * formatting, so a reader has no way to know it is a date. Values are also accepted as
 * real Dates in case someone reformats the column.
 */
export function excelSerialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC + serial * MS_PER_DAY)
}

/** Header aliases, lower-cased and trimmed. Real files carry trailing spaces and typos. */
const HEADER_ALIASES: Record<keyof Omit<SubjectInfo, 'ratId'>, string[]> = {
  ratIdRaw: ['rat id', 'ratid', 'animal id', 'animalid', 'subject', 'subject id', 'id'],
  genotype: ['genotype', 'geno', 'group'],
  sex: ['sex', 'gender'],
  birthday: ['birthday', 'birth date', 'birthdate', 'dob', 'date of birth'],
  set: ['set', 'cohort', 'batch'],
}

function findColumn(header: string[], aliases: string[]): number {
  const normalized = header.map((h) => String(h ?? '').trim().toLowerCase())
  for (const alias of aliases) {
    const i = normalized.indexOf(alias)
    if (i !== -1) return i
  }
  return -1
}

/** Coerces a spreadsheet cell into a Date, accepting Dates, Excel serials and strings. */
function toDate(cell: unknown): Date | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    // Excel serials for plausible rat birthdays are in the tens of thousands. A value
    // below 1000 is far likelier to be a stray number than a date in 1902.
    return cell > 1000 ? excelSerialToDate(cell) : null
  }
  if (typeof cell === 'string' && cell.trim() !== '') {
    const t = Date.parse(cell.trim())
    return Number.isNaN(t) ? null : new Date(t)
  }
  return null
}

function toNumber(cell: unknown): number | null {
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell
  if (typeof cell === 'string' && cell.trim() !== '') {
    const n = Number(cell.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null
  const s = String(cell).trim()
  return s === '' ? null : s
}

export interface RatInfoResult {
  subjects: SubjectInfo[]
  /** Non-fatal problems: duplicate IDs, unreadable rows, missing optional columns. */
  problems: string[]
}

/**
 * Reads a `Rat Info.xlsx` reference sheet into subject records.
 *
 * Column headers are matched case-insensitively against a small alias list rather than by
 * exact string, because the lab's file has trailing spaces in four of its five headers
 * (`Genotype `, `Birthday `, `Set `) and other copies may word them slightly differently.
 */
export async function parseRatInfo(file: Blob): Promise<RatInfoResult> {
  // This reader always returns one entry per worksheet: [{ sheet, data }, ...].
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: unknown[][] }[]
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('That file has no worksheets in it.')
  }

  const problems: string[] = []

  // Prefer whichever sheet actually has a Rat ID column, so a workbook with a cover sheet
  // or notes tab still works, and fall back to the first sheet for the error message.
  const candidates = sheets.map((s) => {
    const rows = (s.data ?? []).filter(
      (r) => Array.isArray(r) && r.some((c) => toText(c) !== null),
    )
    const header = (rows[0] as unknown[] | undefined)?.map((c) => String(c ?? '')) ?? []
    return { name: s.sheet, rows, header, idCol: findColumn(header, HEADER_ALIASES.ratIdRaw) }
  })

  const chosen = candidates.find((c) => c.idCol !== -1)
  if (!chosen) {
    const found = candidates[0]?.header.join(', ') || '(no header row)'
    throw new Error(
      `Could not find a "Rat ID" column in the Rat Info file. The first sheet's columns are: ${found}`,
    )
  }
  if (candidates.length > 1) {
    problems.push(
      `The workbook has ${candidates.length} sheets; "${chosen.name}" was used because it has a Rat ID column.`,
    )
  }

  const { rows, header, idCol } = chosen
  if (rows.length === 0) {
    throw new Error('That spreadsheet is empty. Expected a header row and one row per rat.')
  }
  const genotypeCol = findColumn(header, HEADER_ALIASES.genotype)
  const sexCol = findColumn(header, HEADER_ALIASES.sex)
  const birthdayCol = findColumn(header, HEADER_ALIASES.birthday)
  const setCol = findColumn(header, HEADER_ALIASES.set)

  for (const [label, col] of [
    ['Genotype', genotypeCol],
    ['Sex', sexCol],
    ['Birthday', birthdayCol],
    ['Set', setCol],
  ] as const) {
    if (col === -1) {
      problems.push(`No "${label}" column found, so ${label} will be blank for every rat.`)
    }
  }

  const subjects: SubjectInfo[] = []
  const seen = new Map<string, string>()

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[]
    const ratIdRaw = toText(row[idCol])
    if (!ratIdRaw) continue

    const ratId = normalizeAnimalId(ratIdRaw)
    const previous = seen.get(ratId)
    if (previous !== undefined) {
      problems.push(
        `Rat "${ratIdRaw}" on row ${r + 1} duplicates "${previous}"; the first entry is used.`,
      )
      continue
    }
    seen.set(ratId, ratIdRaw)

    subjects.push({
      ratIdRaw,
      ratId,
      genotype: genotypeCol === -1 ? null : toText(row[genotypeCol]),
      sex: sexCol === -1 ? null : normalizeSex(toText(row[sexCol])),
      birthday: birthdayCol === -1 ? null : toDate(row[birthdayCol]),
      set: setCol === -1 ? null : toNumber(row[setCol]),
    })
  }

  if (subjects.length === 0) {
    throw new Error(
      'No rats were found in that Rat Info file. Check that the first row is a header row.',
    )
  }

  return { subjects, problems }
}
