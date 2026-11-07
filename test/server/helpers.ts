import { join } from 'node:path'
import { createHandler, type HandlerOptions } from '../../src/server/handler.js'
import { createLive } from '../../src/server/live.js'
import { loadProject } from '../../src/server/project.js'
import { fsAssets } from '../../src/server/assets.js'

export const FIXTURE = join(import.meta.dirname, 'fixtures', 'basic')

export async function fixtureHandler(extra: Partial<HandlerOptions> = {}, live = true) {
  const project = await loadProject(FIXTURE)
  const handler = createHandler({
    app: project,
    assets: fsAssets([project.publicDir!]),
    live: live ? createLive(project, { idleTimeout: 0 }) : undefined,
    ...extra,
  })
  return { project, handler }
}

/** Reads SSE events from a response until `until` returns true (or timeout). */
export async function readEvents(res: Response, until: (events: { event: string; data: string }[]) => boolean, timeout = 3000) {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  const events: { event: string; data: string }[] = []
  let buf = ''
  const deadline = Date.now() + timeout
  while (!until(events)) {
    const left = deadline - Date.now()
    if (left <= 0) throw new Error('timeout; got ' + JSON.stringify(events.map((e) => e.event)))
    const r = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), left))])
    if (!r) continue
    if (r.done) break
    buf += dec.decode(r.value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data.push(line.slice(6))
      }
      if (data.length) events.push({ event, data: data.join('\n') })
    }
  }
  return { events, cancel: () => reader.cancel() }
}
