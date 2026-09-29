import { describe, expect, it } from 'vitest'
import { dpiToPixelsPerMetre, readPngDpi, readPngSize, setPngDpi } from '../pngDpi'
// Imported from figureOptions, not figureExport, so the test does not pull in Plotly.
import {
  CSS_PPI,
  pixelDimensions,
  plotlyScaleFor,
  plottedValuesToCsv,
  safeFileName,
} from '../figureOptions'

/** Builds a minimal but structurally valid PNG: signature, IHDR, IDAT, IEND. */
function makePng(width: number, height: number, withPhys = false): ArrayBuffer {
  const chunks: Uint8Array[] = []

  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length, false)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    const body = out.subarray(4, 8 + data.length)
    view.setUint32(8 + data.length, crc(body), false)
    return out
  }

  chunks.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width, false)
  ihdrView.setUint32(4, height, false)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  chunks.push(chunk('IHDR', ihdr))

  if (withPhys) {
    const phys = new Uint8Array(9)
    const physView = new DataView(phys.buffer)
    physView.setUint32(0, 1000, false)
    physView.setUint32(4, 1000, false)
    phys[8] = 1
    chunks.push(chunk('pHYs', phys))
  }

  chunks.push(chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])))
  chunks.push(chunk('IEND', new Uint8Array(0)))

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const c of chunks) {
    out.set(c, cursor)
    cursor += c.length
  }
  return out.buffer
}

describe('DPI arithmetic', () => {
  it('converts DPI to the pixels-per-metre a pHYs chunk stores', () => {
    // 600 DPI / 0.0254 m per inch = 23622 px/m.
    expect(dpiToPixelsPerMetre(600)).toBe(23622)
    expect(dpiToPixelsPerMetre(300)).toBe(11811)
    expect(dpiToPixelsPerMetre(1200)).toBe(47244)
  })

  it('sizes a figure so the requested DPI is really achieved', () => {
    // A 6x4 inch figure at 600 DPI must be 3600x2400 pixels.
    const dims = pixelDimensions({
      format: 'png',
      widthIn: 6,
      heightIn: 4,
      heightAuto: false,
      dpi: 600,
      fileName: 'f',
    })
    expect(dims).toEqual({ width: 3600, height: 2400 })
  })

  it('derives the Plotly scale factor from the DPI', () => {
    // Plotly lays out at 96 px/inch, so 600 DPI needs a 6.25x scale. Getting this wrong is
    // how you end up with a huge canvas and unreadably small text.
    expect(CSS_PPI).toBe(96)
    expect(plotlyScaleFor(600)).toBe(6.25)
    expect(plotlyScaleFor(1200)).toBe(12.5)
    expect(plotlyScaleFor(300)).toBe(3.125)

    // The layout size times the scale must equal the requested pixel dimensions.
    const opts = { format: 'png' as const, widthIn: 6.5, heightIn: 4.5, heightAuto: false, dpi: 600, fileName: 'f' }
    const layoutWidth = Math.round(opts.widthIn * CSS_PPI)
    expect(Math.round(layoutWidth * plotlyScaleFor(opts.dpi))).toBe(
      pixelDimensions(opts).width,
    )
  })
})

describe('pHYs chunk injection', () => {
  it('stamps a PNG with the requested resolution', () => {
    const stamped = setPngDpi(makePng(3600, 2400), 600)
    expect(readPngDpi(stamped)).toEqual({ dpi: 600, pixelsPerMetre: 23622 })
    // Without this the file would claim 96 DPI and be placed 6x too large.
    expect(readPngDpi(makePng(3600, 2400))).toBeNull()
  })

  it('leaves the image itself untouched', () => {
    const original = makePng(3600, 2400)
    const stamped = setPngDpi(original, 600)
    expect(readPngSize(stamped)).toEqual({ width: 3600, height: 2400 })
    // Exactly one 21-byte pHYs chunk was added, nothing else changed.
    expect(stamped.byteLength).toBe(original.byteLength + 21)
  })

  it('replaces an existing pHYs rather than adding a second one', () => {
    const withPhys = makePng(100, 100, true)
    expect(readPngDpi(withPhys)?.pixelsPerMetre).toBe(1000)
    const stamped = setPngDpi(withPhys, 300)
    expect(readPngDpi(stamped)).toEqual({ dpi: 300, pixelsPerMetre: 11811 })
    // Same size: one chunk swapped for another of equal length, not appended.
    expect(stamped.byteLength).toBe(withPhys.byteLength)
  })

  it('produces a chunk with a valid CRC', () => {
    // readPngDpi walks the chunk list by declared length, so a wrong length or a chunk
    // written in the wrong place would desynchronise the walk and lose IEND.
    const stamped = setPngDpi(makePng(800, 600), 1200)
    const bytes = new Uint8Array(stamped)
    const view = new DataView(stamped)
    const seen: string[] = []
    let offset = 8
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset, false)
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
      seen.push(type)
      if (type === 'IEND') break
      offset += 12 + length
    }
    // pHYs must sit after IHDR and before IDAT, as the PNG spec requires.
    expect(seen).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
  })

  it('refuses a file that is not a PNG', () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer
    expect(() => setPngDpi(notPng, 600)).toThrow(/not a PNG/)
  })
})

describe('plotted values CSV', () => {
  it('writes the numbers behind a figure, quoting only where needed', async () => {
    const blob = plottedValuesToCsv({
      columns: ['Group', 'Mean', 'SEM'],
      rows: [
        ['WT', 75.5, 2.1],
        ['AD, treated', 61.25, null],
      ],
    })
    const text = await blob.text()
    expect(text).toBe('Group,Mean,SEM\nWT,75.5,2.1\n"AD, treated",61.25,')
  })
})

describe('file names', () => {
  it('strips characters that break filenames', () => {
    expect(safeFileName('Percent Correct by Genotype')).toBe('Percent_Correct_by_Genotype')
    expect(safeFileName('a/b:c*d?')).toBe('a-b-c-d')
    expect(safeFileName('')).toBe('figure')
  })
})
