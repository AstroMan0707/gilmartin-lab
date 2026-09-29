import { beforeEach, describe, expect, it } from 'vitest'
import { computeBins } from '../analysis/binning'
import { defaultSpec, type ChartSpec } from '../charts/spec'
import {
  checkPreset,
  clearPresetHash,
  deletePreset,
  describePreset,
  listPresets,
  presetFromHash,
  presetLink,
  presetsAvailable,
  savePreset,
  PRESET_VERSION,
  type AnalysisPreset,
} from '../presets'
import type { Registry, VariableDef } from '../variables/registry'

/** A spec of the shape a real selection produces. */
function sampleSpec(): ChartSpec {
  return {
    ...defaultSpec(),
    type: 'bar',
    measureKeys: ['percentCorrect', 'correctTrials'],
    xKey: 'genotype',
    seriesKey: 'correctImageLatency__bin',
    unit: 'subject',
    bins: {
      correctImageLatency: {
        variableKey: 'correctImageLatency',
        mode: 'custom',
        binCount: 3,
        edges: [6, 12],
      },
    },
    title: 'Accuracy by genotype',
  }
}

function def(key: string, label: string): VariableDef {
  return {
    key,
    label,
    role: 'DV',
    type: 'continuous',
    level: 'session',
    source: 'derived',
    binnable: false,
    ordered: false,
  }
}

function fakeRegistry(keys: [string, string][]): Registry {
  const variables = keys.map(([k, l]) => def(k, l))
  return {
    variables,
    byKey: new Map(variables.map((v) => [v.key, v])),
    markerToKey: new Map(),
  }
}

beforeEach(() => {
  window.localStorage.clear()
  clearPresetHash()
})

describe('saving presets', () => {
  it('round-trips a full analysis configuration', () => {
    const spec = sampleSpec()
    savePreset('Accuracy by genotype', spec, true)

    const [saved] = listPresets()
    expect(saved.name).toBe('Accuracy by genotype')
    expect(saved.includeCorrectionTrials).toBe(true)
    expect(saved.spec.measureKeys).toEqual(['percentCorrect', 'correctTrials'])
    expect(saved.spec.xKey).toBe('genotype')
    expect(saved.spec.seriesKey).toBe('correctImageLatency__bin')
    expect(saved.spec.type).toBe('bar')
    // The custom cut points are part of the analysis and must survive.
    expect(saved.spec.bins.correctImageLatency.edges).toEqual([6, 12])
    expect(saved.spec.bins.correctImageLatency.mode).toBe('custom')
  })

  it('stores chart settings only, never data', () => {
    savePreset('p', sampleSpec(), false)
    const raw = window.localStorage.getItem('tunl-parser.presets.v1') ?? ''

    // The guarantee that makes persisting presets safe at all: nothing identifying an animal,
    // a file, or a measurement can appear in storage.
    for (const forbidden of ['LZ039', 'example-input', '.xml', '.xlsx']) {
      expect(raw).not.toContain(forbidden)
    }
    expect(raw).not.toMatch(/animalId"\s*:\s*"[A-Z]{2}\d/)
  })

  it('replaces a preset saved under the same name', () => {
    savePreset('Same name', { ...sampleSpec(), xKey: 'genotype' }, false)
    savePreset('same NAME', { ...sampleSpec(), xKey: 'sex' }, false)

    const all = listPresets()
    expect(all).toHaveLength(1)
    expect(all[0].spec.xKey).toBe('sex')
  })

  it('lists newest first and deletes by id', () => {
    savePreset('first', sampleSpec(), false)
    savePreset('second', sampleSpec(), false)
    expect(listPresets().map((p) => p.name)).toEqual(['second', 'first'])

    const target = listPresets().find((p) => p.name === 'first')!
    expect(deletePreset(target.id).map((p) => p.name)).toEqual(['second'])
  })

  it('falls back to a name rather than saving an untitled blank', () => {
    savePreset('   ', sampleSpec(), false)
    expect(listPresets()[0].name).toBe('Untitled analysis')
  })

  it('survives corrupt storage instead of crashing the app', () => {
    window.localStorage.setItem('tunl-parser.presets.v1', '{not json at all')
    expect(listPresets()).toEqual([])
  })

  it('ignores presets written by an incompatible version', () => {
    window.localStorage.setItem(
      'tunl-parser.presets.v1',
      JSON.stringify([{ id: 'x', name: 'old', spec: {}, version: 999 }]),
    )
    expect(listPresets()).toEqual([])
  })

  it('reports whether storage is usable at all', () => {
    expect(presetsAvailable()).toBe(true)
  })

  it('keeps working when the browser blocks local storage', () => {
    // Private windows and blocked-cookie settings do this. The app must stay usable — presets
    // simply do not survive the tab — rather than throwing on startup.
    const real = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('access denied')
      },
      configurable: true,
    })
    try {
      expect(presetsAvailable()).toBe(false)
      expect(listPresets()).toEqual([])
      expect(() => savePreset('x', sampleSpec(), false)).not.toThrow()
      expect(() => deletePreset('x')).not.toThrow()
    } finally {
      Object.defineProperty(window, 'localStorage', { value: real, configurable: true, writable: true })
    }
  })
})

describe('sharing by link', () => {
  it('round-trips through a URL', () => {
    savePreset('Shared analysis', sampleSpec(), true)
    const preset = listPresets()[0]
    const link = presetLink(preset, 'http://lab-server:8477/')

    const recovered = presetFromHash(new URL(link).hash)
    expect(recovered).not.toBeNull()
    expect(recovered!.name).toBe('Shared analysis')
    expect(recovered!.includeCorrectionTrials).toBe(true)
    expect(recovered!.spec.measureKeys).toEqual(preset.spec.measureKeys)
    expect(recovered!.spec.bins.correctImageLatency.edges).toEqual([6, 12])
  })

  it('puts the preset in the fragment, which browsers never send to the server', () => {
    savePreset('p', sampleSpec(), false)
    const link = presetLink(listPresets()[0], 'http://lab-server:8477/')
    const url = new URL(link)

    expect(url.hash.startsWith('#preset=')).toBe(true)
    // Nothing in the path or query, so nginx's access log cannot capture the analysis.
    expect(url.pathname).toBe('/')
    expect(url.search).toBe('')
    // Base64url only, so the link survives being pasted into an email or chat message.
    expect(url.hash.slice('#preset='.length)).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('ignores a malformed or unrelated hash', () => {
    expect(presetFromHash('#preset=not-valid-base64!!')).toBeNull()
    expect(presetFromHash('#something-else')).toBeNull()
    expect(presetFromHash('')).toBeNull()
  })
})

describe('reading a hand-edited link', () => {
  /** Whatever someone typed into a link, read back the way the app reads a shared one. */
  function openLink(spec: Record<string, unknown>) {
    const raw = { id: 'x', name: 'Edited', createdAt: '', version: PRESET_VERSION, includeCorrectionTrials: false, spec }
    const recovered = presetFromHash(new URL(presetLink(raw as unknown as AnalysisPreset, 'http://h/')).hash)
    expect(recovered).not.toBeNull()
    return recovered!.spec
  }

  it('repairs a bin spec with no edges, which used to throw while drawing', () => {
    const spec = openLink({ bins: { rewardLatency: { mode: 'custom' } } })
    expect(spec.bins.rewardLatency).toEqual({
      variableKey: 'rewardLatency',
      mode: 'custom',
      binCount: 4,
      edges: [],
    })
    // The call that used to throw a TypeError during render.
    expect(() => computeBins(spec.bins.rewardLatency, [])).not.toThrow()
  })

  it('caps bin counts at what the editor allows, instead of freezing the tab', () => {
    const spec = openLink({
      bins: { rewardLatency: { mode: 'equal-count', binCount: 2e6, edges: [] } },
      histogramBins: 1e9,
    })
    expect(spec.bins.rewardLatency.binCount).toBe(12)
    expect(spec.histogramBins).toBe(100)
    expect(openLink({ histogramBins: -5 }).histogramBins).toBe(5)
  })

  it('bins the variable a spec is filed under, never a different one', () => {
    const spec = openLink({ bins: { rewardLatency: { variableKey: 'correctImageLatency', mode: 'custom', binCount: 3, edges: [6] } } })
    expect(spec.bins.rewardLatency.variableKey).toBe('rewardLatency')
  })

  it('drops edges and labels of the wrong type', () => {
    const spec = openLink({
      bins: { x: { mode: 'custom', binCount: 3, edges: [6, 'twelve', null, 20], labels: ['fast', 3, null] } },
    })
    expect(spec.bins.x.edges).toEqual([6, 20])
    expect(spec.bins.x.labels).toEqual(['fast', null, null])
  })

  it('falls back to the defaults for an unknown chart type, unit or mode', () => {
    const spec = openLink({ type: 'pie', unit: 'bogus', bins: { x: { mode: 'magic', binCount: 3, edges: [] } } })
    expect(spec.type).toBe(defaultSpec().type)
    // An unknown unit used to behave as "Each session" and read "one row per undefined".
    expect(spec.unit).toBe('subject')
    expect(spec.bins.x.mode).toBe('equal-count')
  })

  it('reads only true and false as on and off', () => {
    // "no" used to count as true.
    const spec = openLink({ showErrorBars: 'no', showValues: 'yes' })
    expect(spec.showErrorBars).toBe(defaultSpec().showErrorBars)
    expect(spec.showValues).toBe(defaultSpec().showValues)
    expect(openLink({ showErrorBars: false }).showErrorBars).toBe(false)
  })

  it('de-duplicates and caps the measures', () => {
    const many = Array.from({ length: 500 }, (_, i) => `m${i}`)
    expect(openLink({ measureKeys: ['a', 'a', 7, '', 'b'] }).measureKeys).toEqual(['a', 'b'])
    expect(openLink({ measureKeys: many }).measureKeys).toHaveLength(50)
  })

  it('ignores bins that are not an object of objects', () => {
    expect(openLink({ bins: [1, 2] }).bins).toEqual({})
    expect(openLink({ bins: { x: 'custom' } }).bins).toEqual({})
  })

  it('leaves a well-formed preset exactly as saved', () => {
    expect(openLink(sampleSpec() as unknown as Record<string, unknown>)).toEqual(sampleSpec())
  })
})

describe('checking a preset against loaded data', () => {
  const registry = fakeRegistry([
    ['percentCorrect', 'Percent Correct'],
    ['correctTrials', 'Correct Trials'],
    ['genotype', 'Genotype'],
    ['correctImageLatency', 'Correct Response Latency'],
  ])

  const preset = (spec: Partial<ChartSpec>): AnalysisPreset => ({
    id: 'p',
    name: 'p',
    createdAt: '2026-01-01T00:00:00.000Z',
    spec: { ...sampleSpec(), ...spec },
    includeCorrectionTrials: false,
    version: PRESET_VERSION,
  })

  it('passes when every variable the preset needs is present', () => {
    expect(checkPreset(preset({}), registry)).toEqual({ missing: [], ok: true })
  })

  it('names the variables the loaded data does not have', () => {
    // The case this exists for: a preset built on one schedule, opened against another. Without
    // this the playground would render an empty figure with no explanation.
    const check = checkPreset(preset({ measureKeys: ['percentCorrect', 'nonesuch'] }), registry)
    expect(check.ok).toBe(false)
    expect(check.missing).toEqual(['nonesuch'])
  })

  it('resolves a binned grouping to its underlying variable', () => {
    // seriesKey is 'correctImageLatency__bin'; the registry holds the un-suffixed key.
    expect(checkPreset(preset({}), registry).missing).toEqual([])
    expect(checkPreset(preset({ seriesKey: 'missingThing__bin' }), registry).missing).toEqual([
      'missingThing',
    ])
  })

  it('raises nothing before any data is loaded', () => {
    expect(checkPreset(preset({}), null)).toEqual({ missing: [], ok: true })
  })
})

describe('describing a preset', () => {
  const registry = fakeRegistry([
    ['percentCorrect', 'Percent Correct'],
    ['genotype', 'Genotype'],
    ['correctImageLatency', 'Correct Response Latency'],
  ])

  it('reads as a sentence using friendly labels', () => {
    const p: AnalysisPreset = {
      id: 'p',
      name: 'p',
      createdAt: '2026-01-01T00:00:00.000Z',
      spec: {
        ...defaultSpec(),
        measureKeys: ['percentCorrect'],
        xKey: 'genotype',
        seriesKey: 'correctImageLatency__bin',
      },
      includeCorrectionTrials: false,
      version: PRESET_VERSION,
    }
    expect(describePreset(p, registry)).toBe(
      'Percent Correct by Genotype split by Correct Response Latency (ranges)',
    )
  })
})
