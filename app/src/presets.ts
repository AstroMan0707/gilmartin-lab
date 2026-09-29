import { defaultSpec, type ChartSpec } from './charts/spec'
import type { Registry } from './variables/registry'

/**
 * Saved analysis configurations.
 *
 * A preset records *how to look at data*, never data itself: which measures are selected, what
 * they are grouped by, the chart type, the bin edges the user typed, and the aggregation unit.
 * Nothing here is derived from a loaded session, so saving presets does not weaken the property
 * that subject data never outlives the browser tab. That is what makes this possible without a
 * backend: the app has nowhere to write data, but the browser can keep a few hundred bytes of
 * the user's own settings.
 */
export interface AnalysisPreset {
  id: string
  name: string
  /** ISO date, shown in the list so the newest is identifiable. */
  createdAt: string
  spec: ChartSpec
  /** Part of the analysis, so it travels with the preset. */
  includeCorrectionTrials: boolean
  /** Bumped if the shape ever changes, so old presets can be rejected rather than misread. */
  version: number
}

export const PRESET_VERSION = 1
const STORAGE_KEY = 'tunl-parser.presets.v1'
const HASH_PREFIX = '#preset='

/** localStorage is unavailable in private windows and when cookies are blocked. */
function storage(): Storage | null {
  try {
    const s = window.localStorage
    const probe = '__tunl_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export function presetsAvailable(): boolean {
  return storage() !== null
}

/** Only the fields that describe the analysis; anything else is ignored on read. */
function sanitiseSpec(raw: unknown): ChartSpec {
  const base = defaultSpec()
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Partial<ChartSpec>
  return {
    ...base,
    type: r.type ?? base.type,
    measureKeys: Array.isArray(r.measureKeys) ? r.measureKeys.filter((k) => typeof k === 'string') : [],
    xKey: typeof r.xKey === 'string' ? r.xKey : null,
    seriesKey: typeof r.seriesKey === 'string' ? r.seriesKey : null,
    unit: r.unit ?? base.unit,
    bins: typeof r.bins === 'object' && r.bins !== null ? r.bins : {},
    histogramBins: typeof r.histogramBins === 'number' ? r.histogramBins : base.histogramBins,
    showErrorBars: r.showErrorBars ?? base.showErrorBars,
    showValues: r.showValues ?? base.showValues,
    title: typeof r.title === 'string' ? r.title : '',
    xLabel: typeof r.xLabel === 'string' ? r.xLabel : '',
    yLabel: typeof r.yLabel === 'string' ? r.yLabel : '',
  }
}

function sanitisePreset(raw: unknown): AnalysisPreset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<AnalysisPreset>
  if (r.version !== PRESET_VERSION) return null
  if (typeof r.name !== 'string' || r.name.trim() === '') return null
  return {
    id: typeof r.id === 'string' ? r.id : newId(),
    name: r.name.slice(0, 80),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    spec: sanitiseSpec(r.spec),
    includeCorrectionTrials: r.includeCorrectionTrials === true,
    version: PRESET_VERSION,
  }
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function listPresets(): AnalysisPreset[] {
  const s = storage()
  if (!s) return []
  try {
    const raw = JSON.parse(s.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(sanitisePreset).filter((p): p is AnalysisPreset => p !== null)
  } catch {
    // A corrupt entry should not take the app down; start from empty.
    return []
  }
}

function write(presets: AnalysisPreset[]): AnalysisPreset[] {
  const s = storage()
  if (s) {
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(presets))
    } catch {
      // Quota exhausted, or storage disabled mid-session. The in-memory list still works for
      // this session, so fail quietly rather than losing the user's selection.
    }
  }
  return presets
}

export function savePreset(
  name: string,
  spec: ChartSpec,
  includeCorrectionTrials: boolean,
): AnalysisPreset[] {
  const preset: AnalysisPreset = {
    id: newId(),
    name: name.trim().slice(0, 80) || 'Untitled analysis',
    createdAt: new Date().toISOString(),
    spec,
    includeCorrectionTrials,
    version: PRESET_VERSION,
  }
  // Saving under an existing name replaces it, which is what "save" means to most people.
  const rest = listPresets().filter((p) => p.name.toLowerCase() !== preset.name.toLowerCase())
  return write([preset, ...rest])
}

export function deletePreset(id: string): AnalysisPreset[] {
  return write(listPresets().filter((p) => p.id !== id))
}

// --------------------------------------------------------------------------------------
// Sharing
// --------------------------------------------------------------------------------------

/** Base64url, so a preset survives being pasted into a chat message or an email. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/**
 * A link that reproduces this analysis for anybody who opens it.
 *
 * The preset rides in the URL fragment, which browsers never send to the server — so a shared
 * link carries the configuration without any of it being logged in nginx's access log.
 */
export function presetLink(preset: AnalysisPreset, baseUrl = window.location.href): string {
  const url = new URL(baseUrl)
  url.hash = ''
  return `${url.toString().replace(/#$/, '')}${HASH_PREFIX}${toBase64Url(JSON.stringify(preset))}`
}

/** Reads a preset out of the current URL, if one was shared. Returns null otherwise. */
export function presetFromHash(hash = window.location.hash): AnalysisPreset | null {
  if (!hash.startsWith(HASH_PREFIX)) return null
  try {
    return sanitisePreset(JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length))))
  } catch {
    return null
  }
}

/** Removes the preset from the address bar once applied, so a reload does not re-apply it. */
export function clearPresetHash(): void {
  if (window.location.hash.startsWith(HASH_PREFIX)) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}

// --------------------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------------------

export interface PresetCheck {
  /** Variable keys the preset needs that the loaded data does not provide. */
  missing: string[]
  ok: boolean
}

/**
 * Checks a preset against the loaded data before applying it.
 *
 * A preset built on a TUNL schedule opened against a different one would reference variables
 * that do not exist, and the playground would render nothing with no explanation. Naming the
 * missing variables turns a silent blank chart into an answerable question.
 */
export function checkPreset(preset: AnalysisPreset, registry: Registry | null): PresetCheck {
  if (!registry) return { missing: [], ok: true }
  const missing = missingVariables(preset.spec, registry)
  return { missing, ok: missing.length === 0 }
}

/** Variable keys a chart spec plots or groups by that the registry does not provide. */
export function missingVariables(spec: ChartSpec, registry: Registry): string[] {
  const needed = [...spec.measureKeys, spec.xKey, spec.seriesKey].filter(
    (k): k is string => typeof k === 'string' && k !== '',
  )
  return needed
    .map((k) => k.replace(/__bin$/, ''))
    .filter((k, i, all) => all.indexOf(k) === i)
    .filter((k) => !registry.byKey.has(k))
}

/** Human-readable summary of what a preset will plot, for the saved list. */
export function describePreset(preset: AnalysisPreset, registry: Registry | null): string {
  const label = (key: string | null) => {
    if (!key) return null
    const base = key.replace(/__bin$/, '')
    const name = registry?.byKey.get(base)?.label ?? base
    return key.endsWith('__bin') ? `${name} (ranges)` : name
  }

  const measures = preset.spec.measureKeys.map((k) => label(k)).filter(Boolean)
  const parts: string[] = []
  parts.push(measures.length > 0 ? measures.join(', ') : 'no measures')
  const x = label(preset.spec.xKey)
  if (x) parts.push(`by ${x}`)
  const series = label(preset.spec.seriesKey)
  if (series) parts.push(`split by ${series}`)
  return parts.join(' ')
}
