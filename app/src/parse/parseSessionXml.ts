import type {
  MarkerEntry,
  MarkerSeries,
  ParsedSessionXml,
  SessionInfo,
} from '../types'

/** ABET writes Time/Duration in microseconds. */
const MICROS_PER_SEC = 1_000_000

/**
 * Durations are whole milliseconds in every file we have seen, so three decimals is
 * lossless. Rounding here keeps float noise (1633000 / 1e6 = 1.6329999...) out of the
 * exported spreadsheet and out of test comparisons.
 */
function microsToSec(micros: number): number {
  return Math.round((micros / MICROS_PER_SEC) * 1000) / 1000
}

function textOf(parent: Element, tag: string): string | null {
  // Deliberately only direct children: a Marker's tags are flat, and firstElementChild
  // lookups are much cheaper than getElementsByTagName across 1,400 markers.
  for (let el = parent.firstElementChild; el; el = el.nextElementSibling) {
    if (el.tagName === tag) return el.textContent
  }
  return null
}

/** Parses a numeric marker payload. Returns null for an absent or blank element. */
function numOrNull(raw: string | null): number | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Parses one ABET II `LiEvent` XML export.
 *
 * The critical structural fact: `MarkerData` is a flat list grouped *by marker name*,
 * not by trial. All 99 `Trial Analysis - Condition` elements come first, then all 99
 * `Trial Analysis - No. Correct`, and so on. So we bucket by name while preserving
 * document order within each bucket, and the Nth entry of each `Trial Analysis - *`
 * series describes the same attempt.
 *
 * @throws if the document is not a parseable ABET export.
 */
export function parseSessionXml(xmlText: string): ParsedSessionXml {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')

  // DOMParser reports XML syntax errors as a <parsererror> element rather than throwing.
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(
      `This file is not valid XML. ${parserError.textContent?.trim().slice(0, 200) ?? ''}`,
    )
  }

  const root = doc.documentElement
  if (!root || root.tagName !== 'LiEvent') {
    throw new Error(
      `Expected an ABET II export with a <LiEvent> root element, but found <${root?.tagName ?? 'nothing'}>.`,
    )
  }

  // --- SessionInformation: ordered Name/Value pairs -------------------------------
  const ordered: { name: string; value: string }[] = []
  const lookup = new Map<string, string>()
  const sessionInfoEl = root.querySelector('SessionInformation')
  if (sessionInfoEl) {
    for (let el = sessionInfoEl.firstElementChild; el; el = el.nextElementSibling) {
      if (el.tagName !== 'Information') continue
      const name = textOf(el, 'Name')?.trim()
      if (!name) continue
      const value = textOf(el, 'Value')?.trim() ?? ''
      ordered.push({ name, value })
      // First occurrence wins; ABET does not repeat keys, but be deterministic if it does.
      if (!lookup.has(name)) lookup.set(name, value)
    }
  }
  const sessionInfo: SessionInfo = {
    ordered,
    get: (name: string) => lookup.get(name),
  }

  // --- MarkerData: bucket by name, preserving document order ----------------------
  const series = new Map<string, MarkerSeries>()
  const markerDataEl = root.querySelector('MarkerData')
  if (markerDataEl) {
    for (let el = markerDataEl.firstElementChild; el; el = el.nextElementSibling) {
      if (el.tagName !== 'Marker') continue
      const name = textOf(el, 'Name')?.trim()
      if (!name) continue
      const sourceType = textOf(el, 'SourceType')?.trim() ?? ''

      const timeRaw = numOrNull(textOf(el, 'Time'))
      const durationRaw = numOrNull(textOf(el, 'Duration'))
      const isMeasure = timeRaw !== null || durationRaw !== null

      let entry: MarkerEntry
      if (isMeasure) {
        const durationSec = durationRaw === null ? null : microsToSec(durationRaw)
        entry = {
          value: durationSec,
          timeSec: timeRaw === null ? null : microsToSec(timeRaw),
          durationSec,
        }
      } else {
        // Evaluation carries <Results>, Count carries <Count>. Read both rather than
        // trusting SourceType, so an unfamiliar source type still yields its value.
        const results = numOrNull(textOf(el, 'Results'))
        const count = numOrNull(textOf(el, 'Count'))
        entry = { value: results ?? count, timeSec: null, durationSec: null }
      }

      const existing = series.get(name)
      if (existing) {
        existing.entries.push(entry)
      } else {
        series.set(name, { name, sourceType, entries: [entry] })
      }
    }
  }

  // --- ExportInformation ---------------------------------------------------------
  const exportEl = root.querySelector('ExportInformation')
  const sessionLengthMicros = exportEl ? numOrNull(textOf(exportEl, 'SessionLength')) : null

  return {
    sessionInfo,
    series,
    exportInfo: {
      date: exportEl ? (textOf(exportEl, 'Date')?.trim() ?? undefined) : undefined,
      dllVersion: exportEl ? (textOf(exportEl, 'DllVersion')?.trim() ?? undefined) : undefined,
      sessionLengthSec:
        sessionLengthMicros === null ? undefined : microsToSec(sessionLengthMicros),
    },
  }
}

/** True when a series carries `Measure`-style timed events rather than per-trial values. */
export function isMeasureSeries(s: MarkerSeries): boolean {
  return s.sourceType === 'Measure' || s.entries.some((e) => e.timeSec !== null)
}
