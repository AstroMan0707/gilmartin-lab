import { create } from 'zustand'
import { emptyValueWarning } from '../analysis/emptyValues'
import { buildSessionRows, buildTrialRows, type AnalysisRow } from '../analysis/rows'
import { defaultSpec, type ChartSpec } from '../charts/spec'
import type { ThemeMode } from '../charts/theme'
import { defaultExportOptions, type FigureExportOptions } from '../export/figureOptions'
import { loadFiles, mergeFiles, type LoadInput, type LoadProgress } from '../loadFiles'
import {
  deletePreset as removePreset,
  listPresets,
  missingVariables,
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
  /**
   * Every file chosen on the Load tab, loaded or not. Held here rather than in the tab so it
   * survives switching tabs: each load builds the dataset from this whole list, so adding
   * files after a load loads them alongside the others instead of replacing them.
   */
  files: LoadInput
  /** The list the current dataset was built from, to tell loaded files from new ones. */
  loadedFrom: LoadInput | null

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
  /** Adds picked files to the list; returns any that are neither .xml nor .xlsx. */
  addFiles(files: File[]): File[]
  removeXmlFile(index: number): void
  removeRatInfoFile(): void
  /** Builds the dataset from every file in the list. */
  load(): Promise<void>
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
  files: { xmlFiles: [], ratInfoFile: null },
  loadedFrom: null,
  includeCorrectionTrials: false,
  tab: 'load',
  theme: 'light',
  spec: defaultSpec(),
  exportOptions: defaultExportOptions(),
  presets: listPresets(),
  pendingPreset: null,

  addFiles(incoming) {
    const { files, ignored } = mergeFiles(get().files, incoming)
    set({ files })
    return ignored
  },

  removeXmlFile(index) {
    const { files } = get()
    set({ files: { ...files, xmlFiles: files.xmlFiles.filter((_, i) => i !== index) } })
  },

  removeRatInfoFile() {
    set({ files: { ...get().files, ratInfoFile: null } })
  },

  async load() {
    const files = get().files
    set({ loading: true, loadError: null, progress: null })
    try {
      const loaded = await loadFiles(files, (progress) => set({ progress }))
      const registry = buildRegistry(loaded)
      const emptyValues = emptyValueWarning(loaded, registry)
      const dataset = emptyValues ? { ...loaded, warnings: [...loaded.warnings, emptyValues] } : loaded
      rowCache = null
      const pending = get().pendingPreset
      // Loading again after adding or removing files keeps the chart already built, as long as
      // everything it plots still exists in the new data. A first load, or one that loses a
      // variable the chart uses, starts from the defaults.
      const current = get().dataset ? get().spec : null
      const keepSpec = current !== null && missingVariables(current, registry).length === 0
      set({
        dataset,
        registry,
        loadedFrom: files,
        loading: false,
        progress: null,
        // A shared preset waiting to be applied wins, which is the whole point of opening
        // such a link.
        spec: pending ? pending.spec : keepSpec ? current : defaultSpec(),
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
      files: { xmlFiles: [], ratInfoFile: null },
      loadedFrom: null,
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
