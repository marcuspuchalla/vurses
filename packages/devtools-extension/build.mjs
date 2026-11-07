// Builds the unpacked extension into dist/ (load it from chrome://extensions → "Load unpacked").
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'dist')
mkdirSync(out, { recursive: true })

await build({
  entryPoints: { panel: join(here, 'src/main.ts'), devtools: join(here, 'src/devtools.ts') },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome102',
  sourcemap: true,
  logLevel: 'info',
})
for (const f of readdirSync(join(here, 'static'))) copyFileSync(join(here, 'static', f), join(out, f))
writeFileSync(join(out, 'icon.png'), icon(128))

/** A 128px icon: a green rounded square with a terminal prompt (no image assets in the repo). */
function icon(size) {
  const px = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4
      const r = size * 0.18
      const dx = Math.max(r - x, x - (size - 1 - r), 0)
      const dy = Math.max(r - y, y - (size - 1 - r), 0)
      const inside = dx * dx + dy * dy <= r * r
      const u = x / size
      const v = y / size
      // ">" chevron and "_" cursor
      const chevron = u > 0.22 && u < 0.5 && Math.abs(v - 0.5) < 0.2 && Math.abs(Math.abs(v - 0.5) - (0.5 - u) * 0.75) < 0.05
      const cursor = u > 0.52 && u < 0.78 && v > 0.62 && v < 0.7
      const [R, G, B] = chevron || cursor ? [255, 255, 255] : [0x35, 0x49, 0x5e]
      px.set(inside ? [R, G, B, 255] : [0, 0, 0, 0], i)
      if (inside && !chevron && !cursor && u + v > 1.2) px.set([0x42, 0xb8, 0x83, 255], i)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))])
}
