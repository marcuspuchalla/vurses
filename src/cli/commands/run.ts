import { existsSync, statSync } from 'node:fs'
import { register } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hooksUrl, type Command, type Flags } from '../shared.js'
import type { MountOptions } from '../../app/app.js'

function mountOptions(flags: Flags): MountOptions {
  return {
    theme: typeof flags.theme === 'string' ? flags.theme : undefined,
    mouse: flags.mouse !== false,
    fps: flags.fps ? Number(flags.fps) : undefined,
    alternateScreen: flags['alt-screen'] !== false,
  }
}

async function waitAndExit(app: { waitUntilExit(): Promise<void> }) {
  try {
    await app.waitUntilExit()
    process.exit(0)
  } catch {
    process.exit(1)
  }
}

/** Single-entry mode: the module's default export is the root component. */
async function runEntry(file: string, flags: Flags) {
  register(hooksUrl)
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
  const component = mod.default
  if (!component) return // the module mounted itself
  const { createApp } = await import('../../index.js')
  await waitAndExit(createApp(component as never).mount(mountOptions(flags)))
}

/**
 * App Router mode: discovers `appDir`, creates the router (deep link from
 * `--route`) and mounts it in the terminal.
 */
export async function runRouterApp(appDir: string, flags: Flags = {}) {
  register(hooksUrl)
  const { discoverRoutes, createNodeLoader } = await import('../../router/discover.js')
  const { createAppRouter } = await import('../../router/router.js')
  const { createApp } = await import('../../index.js')
  const manifest = await discoverRoutes(appDir)
  if (!manifest.routes.some((r) => r.page)) {
    console.error(`vuecli: no pages found in ${appDir} (add app/page.vue)`)
    process.exit(1)
  }
  const route = typeof flags.route === 'string' ? flags.route : '/'
  const router = createAppRouter({
    manifest,
    load: await createNodeLoader(),
    initialPath: route.startsWith('/') ? route : '/' + route,
    terminalTitle: flags.title !== false,
  })
  await waitAndExit(createApp(router.component).mount(mountOptions(flags)))
}

async function run(entry: string | undefined, flags: Flags) {
  const target = resolve(entry ?? '.')
  if (!existsSync(target)) {
    console.error(`vuecli: file not found: ${entry}`)
    process.exit(1)
  }
  if (statSync(target).isDirectory()) {
    const { findAppDir } = await import('../../router/discover.js')
    const appDir = typeof flags.app === 'string' ? resolve(target, flags.app) : await findAppDir(target)
    if (!appDir) {
      console.error(`vuecli: ${entry ?? '.'} is a directory without an app/ folder (or page.vue / layout.vue)`)
      process.exit(1)
    }
    return runRouterApp(appDir, flags)
  }
  return runEntry(target, flags)
}

const command: Command = {
  summary: 'Run an app in the terminal: an entry file, or a directory with app/ (App Router)',
  usage: 'vuecli run <entry|dir> [--route /path] [--theme name] [--no-mouse] [--fps n] [--no-alt-screen]',
  run: (args, flags) => run(args[0], flags),
}
export default command
