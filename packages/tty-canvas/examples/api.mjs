// Using tty-canvas directly: draw with the Canvas 2D API, print the result.
//   node examples/api.mjs [halfblock|quadrant|sextant|braille|ascii|kitty|sixel|iterm2]
import { Canvas, Path2D, toAnsi, detectGraphics } from 'tty-canvas'

const mode = process.argv[2] ?? 'halfblock'
const canvas = new Canvas(120, 60)
const ctx = canvas.getContext('2d')

// background gradient
const bg = ctx.createLinearGradient(0, 0, 120, 60)
bg.addColorStop(0, '#1d2b53')
bg.addColorStop(1, '#7e2553')
ctx.fillStyle = bg
ctx.fillRect(0, 0, 120, 60)

// sun with a glow
ctx.shadowColor = '#ffec27'
ctx.shadowBlur = 8
ctx.fillStyle = '#ffa300'
ctx.beginPath()
ctx.arc(90, 20, 10, 0, Math.PI * 2)
ctx.fill()
ctx.shadowBlur = 0
ctx.shadowColor = 'transparent'

// mountains from SVG path data
ctx.fillStyle = '#008751'
ctx.fill(new Path2D('M0 60 L0 42 L22 26 L38 40 L58 22 L84 46 L102 34 L120 44 L120 60 Z'))

// a dashed orbit
ctx.setLineDash([4, 3])
ctx.strokeStyle = '#c2c3c7'
ctx.lineWidth = 1
ctx.beginPath()
ctx.ellipse(60, 30, 50, 18, -0.2, 0, Math.PI * 2)
ctx.stroke()
ctx.setLineDash([])

// text
ctx.fillStyle = '#fff1e8'
ctx.font = 'bold 13px sans-serif'
ctx.fillText('tty-canvas', 6, 16)

console.log(toAnsi(canvas, { mode, background: null }))
if (!['kitty', 'sixel', 'iterm2'].includes(mode)) {
  console.log(`\npixel protocols available here: ${detectGraphics().best ?? 'none'}`)
}
