import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSpec } from '../../charts/spec'
import { mergeFiles } from '../../loadFiles'
import { FIXTURE_DIR, FIXTURE_PAIRS } from '../../parse/__tests__/fixtures'
import { useAppStore } from '../useAppStore'

function fixtureFile(name: string): File {
  return new File([new Uint8Array(readFileSync(join(FIXTURE_DIR, name)))], name)
}

const [xml1, xml2, xml3] = FIXTURE_PAIRS.map((p) => fixtureFile(p.xml))
const ratInfo = fixtureFile('Rat Info.xlsx')
const store = () => useAppStore.getState()

describe('mergeFiles', () => {
  const empty = { xmlFiles: [], ratInfoFile: null }

  it('adds session files to those already chosen, without duplicates', () => {
    const first = mergeFiles(empty, [xml1, ratInfo]).files
    const { files } = mergeFiles(first, [xml1, xml2, xml2])
    expect(files.xmlFiles).toEqual([xml1, xml2])
    // Adding session files keeps the Rat Info already chosen.
    expect(files.ratInfoFile).toBe(ratInfo)
  })

  it('replaces the Rat Info file with a new one', () => {
    const other = new File(['x'], 'Other Rat Info.xlsx')
    const { files } = mergeFiles(mergeFiles(empty, [ratInfo]).files, [other])
    expect(files.ratInfoFile).toBe(other)
  })

  it('returns files that are neither .xml nor .xlsx', () => {
    const notes = new File(['x'], 'notes.txt')
    const { files, ignored } = mergeFiles(empty, [xml1, notes])
    expect(ignored).toEqual([notes])
    expect(files.xmlFiles).toEqual([xml1])
  })
})

describe('loading more files after a load', () => {
  beforeEach(() => store().clear())

  it('loads new files alongside the ones already loaded', async () => {
    store().addFiles([xml1, ratInfo])
    await store().load()
    expect(store().dataset?.xmlFileNames).toEqual([xml1.name])

    // The bug: this used to build a dataset from xml2 alone, dropping xml1, and needed
    // Rat Info to be added again before Load would even run.
    store().addFiles([xml2])
    await store().load()
    expect(store().loadError).toBeNull()
    expect(store().dataset?.xmlFileNames).toEqual([xml1.name, xml2.name])
    expect(store().dataset?.ratInfoFileName).toBe(ratInfo.name)
  })

  it('drops a file removed from the list on the next load', async () => {
    store().addFiles([xml1, xml2, xml3, ratInfo])
    await store().load()
    store().removeXmlFile(1)
    await store().load()
    expect(store().dataset?.xmlFileNames).toEqual([xml1.name, xml3.name])
  })

  it('remembers which files the dataset was built from', async () => {
    store().addFiles([xml1, ratInfo])
    await store().load()
    store().addFiles([xml2])
    // The Load tab marks xml2 as new by comparing against this.
    expect(store().loadedFrom?.xmlFiles).toEqual([xml1])
    expect(store().files.xmlFiles).toEqual([xml1, xml2])
  })

  it('keeps the chart already built when files are added', async () => {
    store().addFiles([xml1, ratInfo])
    await store().load()
    store().updateSpec({ type: 'bar', measureKeys: ['percentCorrect'], xKey: 'genotype', title: 'Mine' })
    const built = store().spec

    // Loading used to reset the playground every time, so adding a session meant rebuilding
    // the figure from scratch.
    store().addFiles([xml2])
    await store().load()
    expect(store().spec).toEqual(built)
  })

  it('starts from the defaults when the chart uses a variable the new data lacks', async () => {
    store().addFiles([xml1, ratInfo])
    await store().load()
    store().updateSpec({ type: 'bar', measureKeys: ['percentCorrect', 'nonesuch'] })

    store().addFiles([xml2])
    await store().load()
    expect(store().spec).toEqual(defaultSpec())
  })

  it('still applies a shared preset waiting for data, over the chart already built', async () => {
    store().addFiles([xml1, ratInfo])
    await store().load()
    store().updateSpec({ type: 'box', measureKeys: ['rewardLatency'], xKey: 'sex' })
    store().saveCurrentAsPreset('shared')
    const shared = store().presets.find((p) => p.name === 'shared')!
    store().updateSpec({ type: 'bar', measureKeys: ['percentCorrect'], xKey: 'genotype' })

    store().setPendingPreset(shared)
    store().addFiles([xml2])
    await store().load()
    expect(store().spec).toEqual(shared.spec)
  })

  it('forgets the file list on Start over', async () => {
    store().addFiles([xml1, ratInfo])
    await store().load()
    store().clear()
    expect(store().files).toEqual({ xmlFiles: [], ratInfoFile: null })
    expect(store().loadedFrom).toBeNull()
    expect(store().dataset).toBeNull()
  })
})
