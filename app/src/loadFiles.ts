import { joinMetadata } from './parse/joinMetadata'
import { parseRatInfo } from './parse/parseRatInfo'
import { parseSession } from './parse/parseSession'
import type { Dataset, DatasetWarning, ParsedSession } from './types'

export interface LoadProgress {
  /** Files finished so far, including any that failed. */
  done: number
  total: number
  /** What is being worked on right now, for the progress caption. */
  current: string
}

export interface LoadInput {
  xmlFiles: File[]
  ratInfoFile: File | null
}

/**
 * Yields to the browser so the progress bar can paint between files.
 *
 * Parsing runs on the main thread rather than in a Web Worker because `DOMParser` is a DOM
 * API and is not available in a worker. Moving it would mean a second, untested XML parser
 * for the worker path; yielding keeps one parser — the one covered by the fixture tests —
 * and a batch of forty files still completes in well under a second in a real browser.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Reads a File as text, rejecting with a message a non-programmer can act on. */
async function readText(file: File): Promise<string> {
  try {
    const text = await file.text()
    // ABET writes a UTF-8 BOM; leaving it in place would make the first tag unparseable.
    return text.replace(/^﻿/, '')
  } catch {
    throw new Error(`"${file.name}" could not be read. It may have moved or been deleted.`)
  }
}

/**
 * Parses a batch of session XMLs plus one Rat Info spreadsheet into a dataset.
 *
 * A file that fails to parse does not abort the load: it becomes a warning and the rest of
 * the batch still goes through, because a single corrupt export should not cost the user
 * the other thirty-nine.
 */
export async function loadFiles(
  input: LoadInput,
  onProgress?: (p: LoadProgress) => void,
): Promise<Dataset> {
  const { xmlFiles, ratInfoFile } = input

  if (xmlFiles.length === 0) {
    throw new Error('Add at least one session XML file to get started.')
  }
  if (!ratInfoFile) {
    throw new Error(
      'A Rat Info spreadsheet is required as well — it supplies each rat\'s genotype, set and birthday.',
    )
  }

  const total = xmlFiles.length + 1
  let done = 0
  const report = (current: string) => onProgress?.({ done, total, current })

  // --- Rat Info first, so a bad reference file fails fast -----------------------------
  report(ratInfoFile.name)
  const { subjects, problems } = await parseRatInfo(ratInfoFile)
  done++

  const warnings: DatasetWarning[] = problems.map((message) => ({
    kind: 'parse-failed',
    message,
    files: [ratInfoFile.name],
  }))

  // --- Session files ------------------------------------------------------------------
  const parsed: ParsedSession[] = []
  const failed: { name: string; reason: string }[] = []

  for (const file of xmlFiles) {
    report(file.name)
    await yieldToBrowser()
    try {
      const session = parseSession(file.name, await readText(file))
      if (session.trials.length === 0) {
        failed.push({
          name: file.name,
          reason: 'no trial data was found in it — it may be an empty or interrupted session',
        })
      } else {
        parsed.push(session)
      }
    } catch (error) {
      failed.push({ name: file.name, reason: error instanceof Error ? error.message : String(error) })
    }
    done++
    report(file.name)
  }

  if (failed.length > 0) {
    warnings.push({
      kind: 'parse-failed',
      message:
        `${failed.length} file(s) could not be used and were skipped: ` +
        failed.map((f) => `"${f.name}" (${f.reason})`).join('; '),
      files: failed.map((f) => f.name),
    })
  }

  if (parsed.length === 0) {
    throw new Error(
      failed.length > 0
        ? `None of the ${xmlFiles.length} file(s) could be read. ${failed[0].reason}`
        : 'No usable session data was found in those files.',
    )
  }

  const joined = joinMetadata(parsed, subjects)

  return {
    sessions: joined.sessions,
    subjects,
    warnings: [...warnings, ...joined.warnings],
    loadedAt: new Date(),
    xmlFileNames: parsed.map((s) => s.fileName),
    ratInfoFileName: ratInfoFile.name,
  }
}

/** Splits a dropped or selected file list into session XMLs and the Rat Info spreadsheet. */
export function categoriseFiles(files: File[]): {
  xmlFiles: File[]
  ratInfoFiles: File[]
  ignored: File[]
} {
  const xmlFiles: File[] = []
  const ratInfoFiles: File[] = []
  const ignored: File[] = []

  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.xml')) xmlFiles.push(file)
    else if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) ratInfoFiles.push(file)
    else ignored.push(file)
  }

  return { xmlFiles, ratInfoFiles, ignored }
}

/**
 * Adds newly picked files to the files already chosen. Session files accumulate,
 * de-duplicated by name and size so dropping the same folder twice is harmless; a new Rat
 * Info spreadsheet replaces the old one. Returns the files that were neither.
 */
export function mergeFiles(current: LoadInput, incoming: File[]): { files: LoadInput; ignored: File[] } {
  const { xmlFiles, ratInfoFiles, ignored } = categoriseFiles(incoming)
  const seen = new Set(current.xmlFiles.map((f) => `${f.name}:${f.size}`))
  const added: File[] = []
  for (const f of xmlFiles) {
    const key = `${f.name}:${f.size}`
    if (!seen.has(key)) {
      seen.add(key)
      added.push(f)
    }
  }
  return {
    files: {
      xmlFiles: [...current.xmlFiles, ...added],
      ratInfoFile: ratInfoFiles[0] ?? current.ratInfoFile,
    },
    ignored,
  }
}

/** Recursively collects files from a drag-and-drop, so a whole folder can be dropped. */
export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)

  if (entries.every((e) => e === null)) {
    // Browser gave us no directory access; fall back to the flat file list.
    return [...dataTransfer.files]
  }

  const out: File[] = []

  const walk = async (entry: FileSystemEntry | null): Promise<void> => {
    if (!entry) return
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => {
        ;(entry as FileSystemFileEntry).file(resolve, () => resolve(null))
      })
      if (file) out.push(file)
      return
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries returns at most 100 entries per call, so keep reading until it is empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries(resolve, () => resolve([]))
        })
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }

  for (const entry of entries) await walk(entry)
  return out
}
