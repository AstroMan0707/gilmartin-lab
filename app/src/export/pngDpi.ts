/** Inches per metre, for converting DPI to the PNG spec's pixels-per-metre. */
const INCHES_PER_METRE = 39.3700787402

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

/** CRC-32 as specified by PNG: over the chunk type and data, not the length. */
function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false) // PNG is big-endian
}

/** Converts a DPI value to the pixels-per-metre integer a `pHYs` chunk stores. */
export function dpiToPixelsPerMetre(dpi: number): number {
  return Math.round(dpi * INCHES_PER_METRE)
}

/**
 * Stamps a PNG with its physical resolution by inserting a `pHYs` chunk.
 *
 * Plotly renders at whatever pixel dimensions it is asked for but writes no resolution
 * metadata, so the file *is* high-resolution while claiming to be 96 DPI. Illustrator,
 * InDesign and Word read that claim, so a 3600×2400 export would be placed as a 37-inch
 * image and a journal's automated resolution check would read 96 DPI. Writing `pHYs` is
 * what makes the DPI the user asked for actually travel with the file.
 *
 * The chunk is inserted immediately after `IHDR`, which is where the PNG specification
 * requires it (before `IDAT`). An existing `pHYs` is replaced.
 *
 * @throws if the input is not a PNG.
 */
export function setPngDpi(png: ArrayBuffer, dpi: number): ArrayBuffer {
  const bytes = new Uint8Array(png)

  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Cannot set the resolution: that file is not a PNG.')
    }
  }

  const view = new DataView(png)

  // Walk the chunk list to find where IHDR ends and whether a pHYs already exists.
  let offset = PNG_SIGNATURE.length
  let insertAt = -1
  let existingStart = -1
  let existingEnd = -1

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    const chunkEnd = offset + 12 + length // length + type + data + crc

    if (type === 'IHDR') insertAt = chunkEnd
    if (type === 'pHYs') {
      existingStart = offset
      existingEnd = chunkEnd
    }
    if (type === 'IEND') break
    offset = chunkEnd
  }

  if (insertAt === -1) throw new Error('That PNG is malformed: it has no IHDR chunk.')

  // pHYs data: 4 bytes x-axis ppu, 4 bytes y-axis ppu, 1 byte unit (1 = metre).
  const ppm = dpiToPixelsPerMetre(dpi)
  const chunk = new Uint8Array(21)
  const chunkView = new DataView(chunk.buffer)
  writeUint32(chunkView, 0, 9) // data length
  chunk[4] = 0x70 // 'p'
  chunk[5] = 0x48 // 'H'
  chunk[6] = 0x59 // 'Y'
  chunk[7] = 0x73 // 's'
  writeUint32(chunkView, 8, ppm)
  writeUint32(chunkView, 12, ppm)
  chunk[16] = 1
  writeUint32(chunkView, 17, crc32(chunk.subarray(4, 17)))

  // Reassemble: everything up to the insertion point, the new chunk, then the rest with
  // any previous pHYs removed.
  const head = bytes.subarray(0, insertAt)
  const tailParts: Uint8Array[] =
    existingStart === -1
      ? [bytes.subarray(insertAt)]
      : [bytes.subarray(insertAt, existingStart), bytes.subarray(existingEnd)]

  const total = head.length + chunk.length + tailParts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  out.set(head, cursor)
  cursor += head.length
  out.set(chunk, cursor)
  cursor += chunk.length
  for (const part of tailParts) {
    out.set(part, cursor)
    cursor += part.length
  }

  return out.buffer
}

/** Reads back a PNG's declared resolution. Returns null when no `pHYs` chunk is present. */
export function readPngDpi(png: ArrayBuffer): { dpi: number; pixelsPerMetre: number } | null {
  const bytes = new Uint8Array(png)
  const view = new DataView(png)
  let offset = PNG_SIGNATURE.length

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    if (type === 'pHYs') {
      const ppm = view.getUint32(offset + 8, false)
      return { dpi: Math.round(ppm / INCHES_PER_METRE), pixelsPerMetre: ppm }
    }
    if (type === 'IEND') return null
    offset += 12 + length
  }
  return null
}

/** Reads a PNG's pixel dimensions from its IHDR chunk. */
export function readPngSize(png: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(png)
  // IHDR data always starts at byte 16: 8 signature + 4 length + 4 type.
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
}
