import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { findFreePort } from '../../src/server/node.js'

const open: Server[] = []
const listen = (port: number, host?: string) =>
  new Promise<Server>((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(port, host, () => (open.push(s), res(s)))
  })
const portOf = (s: Server) => (s.address() as { port: number }).port

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))))
})

describe('findFreePort', () => {
  it('returns the requested port when it is free', async () => {
    const port = portOf(await listen(0))
    await new Promise((r) => open.pop()!.close(r))
    expect(await findFreePort(port)).toBe(port)
  })

  it('skips a port held on IPv4 loopback', async () => {
    const port = portOf(await listen(0, '127.0.0.1'))
    expect(await findFreePort(port)).toBeGreaterThan(port)
  })

  // the bug: another dev server (Vite) on [::1]:3000 — a wildcard bind still
  // succeeds on macOS, but browsers resolve localhost to ::1 and hit the other server
  it('skips a port held only on IPv6 loopback', async () => {
    let held: Server
    try {
      held = await listen(0, '::1')
    } catch {
      return // no IPv6 on this machine
    }
    const port = portOf(held)
    expect(await findFreePort(port)).toBeGreaterThan(port)
  })
})
