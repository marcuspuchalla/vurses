/**
 * End-to-end: spawns `node bin/vurses.js mcp <fixture>` and talks MCP over real
 * stdio. Needs a build (`npm run build`); skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const built = existsSync(`${root}dist/mcp/server.js`) && existsSync(`${root}dist/cli/commands/mcp.js`)

describe.skipIf(!built)('vurses mcp over stdio', () => {
  let client: Client
  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['bin/vurses.js', 'mcp', 'test/mcp/fixtures/app.js', '--size', '50x10'],
      cwd: root,
      stderr: 'pipe',
    })
    client = new Client({ name: 'stdio-test', version: '1.0.0' })
    await client.connect(transport)
  }, 20000)
  afterAll(async () => {
    await client?.close()
  })

  it('reads frames and sends keys', async () => {
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      ((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content.map((c) => c.text).join('\n')
    expect(await call('read_frame')).toContain('Hello MCP')
    expect(await call('type', { text: 'stdio' })).toContain('stdio')
    expect(await call('press', { keys: 'enter' })).toContain('Submitted: stdio')
    expect(await call('get_logs')).toContain('fixture mounted')
  })
})
