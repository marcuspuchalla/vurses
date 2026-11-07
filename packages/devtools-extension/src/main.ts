// Entry of panel.html: wires the panel to the inspected page.
import { FRAME_CSS } from '../../../src/devtools/html.js'
import { chromeBridge } from './bridge.js'
import { Panel } from './panel.js'

const style = document.createElement('style')
style.textContent = FRAME_CSS
document.head.appendChild(style)

const root = document.getElementById('app')!
try {
  const panel = new Panel(root, chromeBridge())
  panel.start()
  const nav = (globalThis as { chrome?: { devtools?: { network?: { onNavigated?: { addListener(fn: () => void): void } } } } }).chrome?.devtools?.network
  nav?.onNavigated?.addListener(() => {
    panel.reset()
    void panel.refresh()
  })
} catch (e) {
  root.innerHTML = `<div class="empty">${(e as Error).message}</div>`
}
