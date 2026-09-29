import type {
  DatasetWarning,
  ParsedSession,
  Session,
  SubjectInfo,
} from '../types'

const MS_PER_DAY = 86_400_000

/**
 * Joins subject metadata onto parsed sessions and derives the cross-session fields the
 * analysis layer needs.
 *
 * Rat Info supplies genotype, set and birthday, which the XML does not record. Sex is
 * recorded by both, and Rat Info wins: sex belongs to the rat, and Rat Info is the one
 * record with a single row per rat, whereas the XML's Sex is typed per session and can
 * vary between a rat's sessions. Taking it per session put one rat in both sex groups and
 * counted it twice. The XML fills in only for rats Rat Info has no sex for, and only when
 * all of that rat's sessions agree. Conflicts are surfaced as warnings rather than
 * silently resolved, because a sex mismatch usually means a rat was run under the wrong
 * ID and the user needs to know before they publish the figure.
 */
export function joinMetadata(
  parsedSessions: ParsedSession[],
  subjects: SubjectInfo[],
): { sessions: Session[]; warnings: DatasetWarning[] } {
  const warnings: DatasetWarning[] = []
  const byId = new Map(subjects.map((s) => [s.ratId, s]))

  // --- Join and resolve conflicting fields -------------------------------------------
  const unmatched = new Map<string, string[]>()
  const sexConflicts: string[] = []

  // Every sex the session files record for each rat, keyed as session numbering keys it.
  // Used only where Rat Info has no sex; one value per rat, or none if the files disagree.
  const xmlSexes = new Map<string, Set<'F' | 'M'>>()
  for (const s of parsedSessions) {
    if (!s.sexXml) continue
    const key = s.animalId || s.fileName
    const set = xmlSexes.get(key) ?? new Set()
    set.add(s.sexXml)
    xmlSexes.set(key, set)
  }
  const inconsistentXmlSex = new Set<string>()

  const joined: Session[] = parsedSessions.map((session) => {
    const subject = byId.get(session.animalId) ?? null

    if (!subject) {
      const files = unmatched.get(session.animalIdRaw) ?? []
      files.push(session.fileName)
      unmatched.set(session.animalIdRaw, files)
    }

    if (subject && session.sexXml && subject.sex && session.sexXml !== subject.sex) {
      sexConflicts.push(
        `${session.animalIdRaw}: the session file says ${session.sexXml}, Rat Info says ${subject.sex}`,
      )
    }

    let sex: 'F' | 'M' | null = subject?.sex ?? null
    if (!sex) {
      const key = session.animalId || session.fileName
      const recorded = xmlSexes.get(key)
      if (recorded?.size === 1) [sex] = recorded
      else if (recorded && recorded.size > 1) inconsistentXmlSex.add(key)
    }

    const ageDays =
      subject?.birthday && session.testDay
        ? Math.round((session.testDay.getTime() - subject.birthday.getTime()) / MS_PER_DAY)
        : null

    return {
      ...session,
      subject,
      genotype: subject?.genotype ?? null,
      sex,
      set: subject?.set ?? null,
      ageDays,
      sessionNumber: 0, // assigned below, once sessions are grouped by subject
    }
  })

  // --- Session numbering: per subject, in date order ---------------------------------
  // This is the longitudinal x-axis. Numbering per subject rather than by calendar date
  // aligns rats that began training weeks apart, which is what a learning curve needs.
  const bySubject = new Map<string, Session[]>()
  for (const s of joined) {
    const key = s.animalId || s.fileName
    const list = bySubject.get(key)
    if (list) list.push(s)
    else bySubject.set(key, [s])
  }

  const missingTestDay: string[] = []
  for (const [, list] of bySubject) {
    list.sort((a, b) => {
      const at = a.testDay?.getTime() ?? Number.POSITIVE_INFINITY
      const bt = b.testDay?.getTime() ?? Number.POSITIVE_INFINITY
      if (at !== bt) return at - bt
      // Same calendar day: fall back to the schedule run ID, which ABET increments, then
      // to filename so the ordering is at least stable across reloads.
      const ar = Number(a.scheduleRunId)
      const br = Number(b.scheduleRunId)
      if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return ar - br
      return a.fileName.localeCompare(b.fileName)
    })
    list.forEach((s, i) => {
      s.sessionNumber = i + 1
      if (!s.testDay) missingTestDay.push(s.fileName)
    })
  }

  // --- Duplicate session detection ---------------------------------------------------
  // The same export loaded twice would double-weight that rat in every group mean.
  const runKeys = new Map<string, string[]>()
  for (const s of joined) {
    const key = `${s.animalId}|${s.scheduleName}|${s.scheduleRunId}`
    const files = runKeys.get(key) ?? []
    files.push(s.fileName)
    runKeys.set(key, files)
  }
  for (const [key, files] of runKeys) {
    if (files.length > 1) {
      const [animal] = key.split('|')
      warnings.push({
        kind: 'duplicate-session',
        message: `${files.length} files describe the same run of ${animal} (schedule run ${key.split('|')[2]}). They are all included, which will weight this rat more heavily.`,
        subjects: [animal],
        files,
      })
    }
  }

  // --- Aggregate the per-session findings into warnings -------------------------------
  for (const [animalId, files] of unmatched) {
    if (animalId === '') {
      // A file with no Animal ID cannot be looked up at all; name the files, since there is
      // no ID to name.
      warnings.push({
        kind: 'unmatched-animal',
        message: `${files.length} session file(s) record no Animal ID, so they have no genotype, set or age, and each counts as a separate rat: ${files.join(', ')}. Their data is still included.`,
        files,
      })
      continue
    }
    warnings.push({
      kind: 'unmatched-animal',
      message: `"${animalId}" is not in the Rat Info file, so it has no genotype, set or age. Its data is still included.`,
      subjects: [animalId],
      files,
    })
  }

  if (sexConflicts.length > 0) {
    warnings.push({
      kind: 'sex-conflict',
      message: `Sex disagrees between the session files and Rat Info for ${sexConflicts.length} session(s). Rat Info is used. ${sexConflicts.join('; ')}`,
      subjects: [...new Set(sexConflicts.map((c) => c.split(':')[0]))],
    })
  }

  if (inconsistentXmlSex.size > 0) {
    const ids = [...inconsistentXmlSex]
    warnings.push({
      kind: 'sex-conflict',
      message: `The session files disagree on the sex of ${ids.join(', ')}, and Rat Info does not record it, so sex is blank for ${ids.length === 1 ? 'this rat' : 'these rats'}. Add ${ids.length === 1 ? 'it' : 'them'} to Rat Info to fix this.`,
      subjects: ids,
    })
  }

  if (missingTestDay.length > 0) {
    warnings.push({
      kind: 'missing-test-day',
      message: `${missingTestDay.length} session(s) have no readable test date, so they are placed last in session order and have no age.`,
      files: missingTestDay,
    })
  }

  const loadedIds = new Set(joined.map((s) => s.animalId))
  const unused = subjects.filter((s) => !loadedIds.has(s.ratId))
  if (unused.length > 0) {
    warnings.push({
      kind: 'unused-subject',
      message: `${unused.length} of ${subjects.length} rats in the Rat Info file have no session data loaded. This is expected if you only loaded part of a cohort.`,
      subjects: unused.map((s) => s.ratIdRaw),
    })
  }

  const collisions = joined.flatMap((s) =>
    s.alignmentWarnings
      .filter((w) => w.reason === 'collision')
      .map(() => s.fileName),
  )
  if (collisions.length > 0) {
    warnings.push({
      kind: 'latency-collision',
      message: `${collisions.length} timed event(s) could not be matched to a single trial. This usually means an unfamiliar schedule; those latencies were left blank.`,
      files: [...new Set(collisions)],
    })
  }

  const withoutDelay = joined.filter((s) => s.delaySec === null).map((s) => s.scheduleName)
  if (withoutDelay.length > 0) {
    warnings.push({
      kind: 'unknown-schedule',
      message: `No delay could be read from the schedule name for ${withoutDelay.length} session(s) (${[...new Set(withoutDelay)].join(', ')}). Delay will be blank for these; other variables are unaffected.`,
    })
  }

  // `joined` was built by mapping over `parsedSessions`, so it is already in load order;
  // only the per-subject lists above were sorted, and those hold references, not copies.
  return { sessions: joined, warnings }
}
