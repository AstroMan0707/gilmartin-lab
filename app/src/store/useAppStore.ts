import { create } from 'zustand'
import { buildSessionRows, buildTrialRows, type AnalysisRow } from '../analysis/rows'
import { defaultSpec, type ChartSpec } from '../charts/spec'
import type { ThemeMode } from '../charts/theme'
import { defaultExportOptions, type FigureExportOptions } from '../export/figureOptions'
import { loadFiles, type LoadInput, type LoadProgress } from '../loadFiles'
import {
  deletePreset as removePreset,
  listPresets,
  savePreset as writePreset,
  type AnalysisPreset,
} from '../presets'
import type { Dataset } from '../types'
import { buildRegistry, type Registry } from '../variables/registry'

export type TabId = 'load' | 'table' | 'playground'

interface AppState {
  // --- Data ---------------------------------------------------------------------------
  dataset: Dataset | null
  registry: Registry | null
  /** Everything is held in memory only; a reload starts from an empty session. */
  loading: boolean
  progress: LoadProgress | null
  loadError: string | null

  // --- Settings that change what the numbers mean --------------------------------------
  /**
   * Whether repeat attempts after an error count as observations. Off by default so
   * accuracy matches how ABET computes it; a global setting rather than a per-chart one so
   * every figure in a paper is built on the same trials.
   */
  includeCorrectionTrials: boolean

  // --- UI ------------------------------------------------------------------------------
  tab: TabId
  theme: ThemeMode
  spec: ChartSpec
  exportOptions: FigureExportOptions

  // --- Saved analyses ------------------------------------------------------------------
  presets: AnalysisPreset[]
  /**
   * A preset opened from a shared link before any data was loaded. Held so it can be applied
   * once files arrive, instead of being discarded by the fresh-load reset.
   */
  pendingPreset: AnalysisPreset | null

  // --- Actions -------------------------------------------------------------------------
  load(input: LoadInput): Promise<void>
  clear(): void
  setTab(tab: TabId): void
  setTheme(theme: ThemeMode): void
  setIncludeCorrectionTrials(value: boolean): void
  updateSpec(patch: Partial<ChartSpec>): void
  resetSpec(): void
  updateExportOptions(patch: Partial<FigureExportOptions>): void
  saveCurrentAsPreset(name: string): void
  applyPreset(preset: AnalysisPreset): void
  removePreset(id: string): void
  /** Queues a shared preset to be applied when data is loaded. */
  setPendingPreset(preset: AnalysisPreset | null): void
  /** Rows at trial level, honouring the correction-trial setting. */
  trialRows(): AnalysisRow[]
  /** Rows at session level, honouring the correction-trial setting. */
  sessionRows(): AnalysisRow[]
}

/**
 * Row building is memoised on the inputs that affect it, because the playground re-reads
 * rows on every interaction and rebuilding tens of thousands of rows per keystroke would
 * make the sliders feel broken.
 */
let rowCache: {
  dataset: Dataset
  includeCorrectionTrials: boolean
  trial: AnalysisRow[]
  session: AnalysisRow[]
} | null = null

export const useAppStore = create<AppState>((set, get) => ({
  dataset: null,
  registry: null,
  loading: false,
  progress: null,
  loadError: null,
  includeCorrectionTrials: false,
  tab: 'load',
  theme: 'light',
  spec: defaultSpec(),
  exportOptions: defaultExportOptions(),
  presets: listPresets(),
  pendingPreset: null,

  async load(input) {
    set({ loading: true, loadError: null, progress: null })
    try {
      const dataset = await loadFiles(input, (progress) => set({ progress }))
      rowCache = null
      const pending = get().pendingPreset
      set({
        dataset,
        registry: buildRegistry(dataset),
        loading: false,
        progress: null,
        // A fresh load invalidates any previous selection, since the variables may differ —
        // unless a shared preset is waiting, which is the whole point of opening such a link.
        spec: pending ? pending.spec : defaultSpec(),
        includeCorrectionTrials: pending
          ? pending.includeCorrectionTrials
          : get().includeCorrectionTrials,
        pendingPreset: null,
        tab: 'playground',
      })
    } catch (error) {
      set({
        loading: false,
        progress: null,
        loadError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  clear() {
    rowCache = null
    set({
      dataset: null,
      registry: null,
      loadError: null,
      progress: null,
      spec: defaultSpec(),
      tab: 'load',
    })
  },

  setTab: (tab) => set({ tab }),
  setTheme: (theme) => set({ theme }),

  setIncludeCorrectionTrials(value) {
    rowCache = null
    set({ includeCorrectionTrials: value })
  },

  updateSpec(patch) {
    set({ spec: { ...get().spec, ...patch } })
  },

  resetSpec() {
    set({ spec: defaultSpec() })
  },

  updateExportOptions(patch) {
    set({ exportOptions: { ...get().exportOptions, ...patch } })
  },

  saveCurrentAsPreset(name) {
    const { spec, includeCorrectionTrials } = get()
    set({ presets: writePreset(name, spec, includeCorrectionTrials) })
  },

  applyPreset(preset) {
    rowCache = null
    set({
      spec: preset.spec,
      includeCorrectionTrials: preset.includeCorrectionTrials,
      tab: 'playground',
    })
  },

  removePreset(id) {
    set({ presets: removePreset(id) })
  },

  setPendingPreset(preset) {
    set({ pendingPreset: preset })
  },

  trialRows() {
    const { dataset, registry, includeCorrectionTrials } = get()
    if (!dataset || !registry) return []
    if (
      rowCache &&
      rowCache.dataset === dataset &&
      rowCache.includeCorrectionTrials === includeCorrectionTrials
    ) {
      return rowCache.trial
    }
    const opts = { includeCorrectionTrials }
    const trial = buildTrialRows(dataset, registry, opts)
    const session = buildSessionRows(dataset, registry, opts)
    rowCache = { dataset, includeCorrectionTrials, trial, session }
    return trial
  },

  sessionRows() {
    const { dataset, registry, includeCorrectionTrials } = get()
    if (!dataset || !registry) return []
    if (
      !rowCache ||
      rowCache.dataset !== dataset ||
      rowCache.includeCorrectionTrials !== includeCorrectionTrials
    ) {
      get().trialRows() // populates both halves of the cache
    }
    return rowCache?.session ?? []
  },
}))
