import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { joinMetadata } from '../../parse/joinMetadata'
import { parseRatInfo } from '../../parse/parseRatInfo'
import { normalizeAnimalId, normalizeSex, parseSession } from '../../parse/parseSession'
import { FIXTURE_DIR, FIXTURE_PAIRS, readFixture } from '../../parse/__tests__/fixtures'
import type { Dataset, ParsedSession, SubjectInfo } from '../../types'
import { buildRegistry } from '../../variables/registry'
import { aggregate } from '../aggregate'
import { buildSessionRows, buildTrialRows } from '../rows'

/*
 * The fixtures hold one session per rat, so nothing else in the suite exercises "Each rat"
 * collapsing several sessions — which is exactly where n went wrong in practice: one rat's
 * files disagreeing on its ID spelling or its sex split it across groups and counted it
 * twice. These tests build cohorts of several sessions per rat and check n against counts
 * written out by hand.
 *
 * Six rats from Rat Info, three sessions each:
 *   female: LZ084, LZ085, LZ095 (all WT)
 *   male:   LZ075, LZ078, LZ080 (LZ078 is AD, the others WT)
 */
const FEMALES = ['LZ084', 'LZ085', 'LZ095']
const MALES = ['LZ075', 'LZ078', 'LZ080']

/** One session file: the Animal ID and Sex as typed in the XML. */
interface FileSpec {
  id: string
  sex: string
}

let subjects: SubjectInfo[]
let bases: ParsedSession[]

beforeAll(async () => {
  const buf = readFileSync(join(FIXTURE_DIR, 'Rat Info.xlsx'))
  ;({ subjects } = await parseRatInfo(new Blob([new Uint8Array(buf)])))
  bases = FIXTURE_PAIRS.map((p) => parseSession(p.xml, readFixture(p.xml)))
})

/**
 * A cohort of sessions, one per spec. Parsing a fresh XML per file made each scenario take
 * seconds, so each file is a fixture session with its identifying fields replaced — through
 * the parser's own normalisers, as parseSession would apply them.
 */
function cohort(files: FileSpec[]): Dataset {
  const seen = new Map<string, number>()
  const parsed = files.map((f, i): ParsedSession => {
    const key = normalizeAnimalId(f.id) || `file${i}`
    const k = seen.get(key) ?? 0
    seen.set(key, k + 1)
    return {
      ...bases[i % bases.length],
      fileName: `file${i}.xml`,
      animalIdRaw: f.id,
      animalId: normalizeAnimalId(f.id),
      sexXml: normalizeSex(f.sex),
      scheduleRunId: String(1000 + i),
      testDay: new Date(Date.UTC(2026, 6, 14 + k)),
    }
  })
  const { sessions, warnings } = joinMetadata(parsed, subjects)
  return {
    sessions,
    subjects,
    warnings,
    loadedAt: new Date(0),
    xmlFileNames: parsed.map((p) => p.fileName),
    ratInfoFileName: 'Rat Info.xlsx',
  }
}

/** Three sessions of one rat, with the Sex field of each. */
function rat(id: string, sexes: [string, string, string]): FileSpec[] {
  return sexes.map((sex) => ({ id, sex }))
}

/** The six rats with their sex typed correctly in every file, except where overridden. */
function standardCohort(overrides: Record<string, FileSpec[]> = {}): FileSpec[] {
  return [
    ...FEMALES.flatMap((id) => overrides[id] ?? rat(id, ['female', 'female', 'female'])),
    ...MALES.flatMap((id) => overrides[id] ?? rat(id, ['male', 'male', 'male'])),
  ]
}

/**
 * n per group for "Each rat", as `label:n` sorted, checked to be the same from session rows
 * and trial rows — the two paths the playground chooses between.
 */
function nByGroup(dataset: Dataset, key: 'sex' | 'genotype'): string {
  const registry = buildRegistry(dataset)
  const fromRows = (rows: ReturnType<typeof buildSessionRows>) =>
    aggregate(rows, 'percentCorrect', [key], 'subject', registry)
      .map((c) => `${c.group.label}:${c.stats.n}`)
      .sort()
      .join(' ')

  const sessionLevel = fromRows(buildSessionRows(dataset, registry, { includeCorrectionTrials: false }))
  const trialLevel = fromRows(buildTrialRows(dataset, registry, { includeCorrectionTrials: true }))
  expect(trialLevel, 'trial rows and session rows disagree on n').toBe(sessionLevel)
  return sessionLevel
}

function warningKinds(dataset: Dataset): string[] {
  return dataset.warnings.map((w) => w.kind).filter((k) => k !== 'unused-subject')
}

describe('n with several sessions per rat', () => {
  it('counts each rat once when the files agree with Rat Info', () => {
    const dataset = cohort(standardCohort())
    expect(nByGroup(dataset, 'sex')).toBe('F:3 M:3')
    expect(nByGroup(dataset, 'genotype')).toBe('AD:1 WT:5')
    expect(warningKinds(dataset)).toEqual([])
  })

  it('keeps males male when every file says "female"', () => {
    // A schedule default nobody changes. The files used to win, putting all six rats in F.
    const all = [...FEMALES, ...MALES]
    const dataset = cohort(all.flatMap((id) => rat(id, ['female', 'female', 'female'])))
    expect(nByGroup(dataset, 'sex')).toBe('F:3 M:3')
    expect(warningKinds(dataset)).toEqual(['sex-conflict'])
  })

  it('does not split a rat whose sessions disagree on its sex', () => {
    // One mistyped session used to put LZ075 in both groups: F:4 M:3 from six rats.
    const dataset = cohort(standardCohort({ LZ075: rat('LZ075', ['male', 'female', 'male']) }))
    expect(nByGroup(dataset, 'sex')).toBe('F:3 M:3')
    expect(dataset.warnings.find((w) => w.kind === 'sex-conflict')?.subjects).toEqual(['LZ075'])
  })

  it('takes sex from Rat Info when the files leave it blank', () => {
    const all = [...FEMALES, ...MALES]
    const dataset = cohort(all.flatMap((id) => rat(id, ['', '', ''])))
    expect(nByGroup(dataset, 'sex')).toBe('F:3 M:3')
    expect(warningKinds(dataset)).toEqual([])
  })

  it('counts a rat once however its ID is spelled across files', () => {
    // Used to count as three rats: M:5 by sex and WT:7 by genotype.
    const dataset = cohort(
      standardCohort({
        LZ075: [
          { id: 'LZ075', sex: 'male' },
          { id: 'lz075', sex: 'male' },
          { id: 'LZ 075', sex: 'male' },
        ],
      }),
    )
    expect(nByGroup(dataset, 'sex')).toBe('F:3 M:3')
    expect(nByGroup(dataset, 'genotype')).toBe('AD:1 WT:5')
  })

  it('uses the files\' sex for a rat missing from Rat Info only if they agree', () => {
    // ZZ901's files agree (one is blank); ZZ902's do not, so its sex is left unknown
    // rather than counting it in both groups, as it used to.
    const dataset = cohort([
      ...standardCohort(),
      ...rat('ZZ901', ['male', 'male', '']),
      ...rat('ZZ902', ['male', 'female', 'male']),
    ])
    expect(nByGroup(dataset, 'sex')).toBe('F:3 M:4 —:1')
    expect(nByGroup(dataset, 'genotype')).toBe('AD:1 WT:5 —:2')
    expect(dataset.warnings.find((w) => w.kind === 'sex-conflict')?.subjects).toEqual(['ZZ902'])
  })

  it('treats each file with no Animal ID as a separate rat', () => {
    // Two ID-less files used to merge into one rat.
    const dataset = cohort([...standardCohort(), { id: '', sex: 'female' }, { id: '', sex: 'female' }])
    expect(nByGroup(dataset, 'sex')).toBe('F:5 M:3')
    expect(nByGroup(dataset, 'genotype')).toBe('AD:1 WT:5 —:2')
  })
})
