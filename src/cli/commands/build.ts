import { relative, resolve } from 'node:path'
import type { Command, Flags } from '../shared.js'

async function build(args: string[], flags: Flags) {
  const { buildApp, ADAPTERS } = await import('../../server/build.js')
  const adapter = (typeof flags.adapter === 'string' ? flags.adapter : 'node') as (typeof ADAPTERS)[number]
  if (!ADAPTERS.includes(adapter)) {
    console.error(`vuecli build: unknown adapter "${adapter}" (${ADAPTERS.join(' | ')})`)
    process.exit(1)
  }
  const t0 = Date.now()
  const out = flags.out ?? flags.outDir
  const r = await buildApp({
    root: resolve(args[0] ?? '.'),
    adapter,
    appDir: typeof flags.app === 'string' ? flags.app : undefined,
    outDir: typeof out === 'string' ? resolve(out) : undefined,
    minify: flags.minify !== false,
    prerender: flags.prerender !== false,
    log: (m) => console.log(`  ${m}`),
    warn: (m) => console.warn(`  ⚠ ${m}`),
  })
  const dir = relative(process.cwd(), r.outDir) || '.'
  console.log(`\n  built (${adapter}) in ${Date.now() - t0} ms → ${dir}`)
  if (r.prerendered.length) console.log(`  prerendered shells: ${r.prerendered.join(', ')}`)
  const next: Record<string, string> = {
    static: `serve ${dir} with any static file host (404.html as fallback)`,
    node: `vuecli start ${dir}   (or: node ${dir}/server.mjs)`,
    bun: `bun ${dir}/bun.mjs`,
    vercel: `vercel deploy --prebuilt`,
    cloudflare: `cd ${dir} && npx wrangler deploy`,
  }
  console.log(`  next: ${next[adapter]}\n`)
}

const command: Command = {
  summary: 'Build for deployment (--adapter static | node | bun | vercel | cloudflare)',
  usage: 'vuecli build [dir] [--adapter node] [--out dir] [--no-minify] [--no-prerender]',
  run: build,
}
export default command
