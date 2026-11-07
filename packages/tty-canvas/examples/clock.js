// A classic analog clock sketch written as ordinary browser JavaScript.
// Run it with `tty-canvas clock.js` (tty-canvas provides a full-window <canvas>),
// or include it in a page with a <canvas> element.
const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')

function fit() {
  canvas.width = innerWidth
  canvas.height = innerHeight
}
addEventListener('resize', fit)
fit()

function hand(angle, length, width, color) {
  ctx.save()
  ctx.rotate(angle)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, length * 0.15)
  ctx.lineTo(0, -length)
  ctx.stroke()
  ctx.restore()
}

function draw() {
  const { width: w, height: h } = canvas
  const r = Math.min(w, h) / 2 - 4
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#101418'
  ctx.fillRect(0, 0, w, h)
  ctx.translate(w / 2, h / 2)

  const face = ctx.createRadialGradient(0, -r / 3, r / 10, 0, 0, r)
  face.addColorStop(0, '#fdfbf3')
  face.addColorStop(1, '#c9c2a8')
  ctx.fillStyle = face
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = r / 10
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = Math.max(1, r / 25)
  ctx.strokeStyle = '#3a3226'
  ctx.stroke()

  for (let i = 0; i < 60; i++) {
    ctx.save()
    ctx.rotate((i / 60) * Math.PI * 2)
    ctx.fillStyle = '#3a3226'
    const big = i % 5 === 0
    ctx.fillRect(-(big ? r / 40 : r / 100), -r * 0.95, big ? r / 20 : r / 50, big ? r / 9 : r / 20)
    ctx.restore()
  }
  ctx.fillStyle = '#3a3226'
  ctx.font = `bold ${Math.round(r / 5)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let n = 1; n <= 12; n++) {
    const a = (n / 12) * Math.PI * 2
    ctx.fillText(String(n), Math.sin(a) * r * 0.7, -Math.cos(a) * r * 0.7)
  }

  const now = new Date()
  const s = now.getSeconds() + now.getMilliseconds() / 1000
  const m = now.getMinutes() + s / 60
  const hr = (now.getHours() % 12) + m / 60
  hand((hr / 12) * Math.PI * 2, r * 0.5, r / 14, '#1c1a16')
  hand((m / 60) * Math.PI * 2, r * 0.75, r / 20, '#1c1a16')
  hand((s / 60) * Math.PI * 2, r * 0.85, Math.max(1, r / 60), '#c0392b')
  ctx.fillStyle = '#c0392b'
  ctx.beginPath()
  ctx.arc(0, 0, r / 25, 0, Math.PI * 2)
  ctx.fill()
  requestAnimationFrame(draw)
}
requestAnimationFrame(draw)
