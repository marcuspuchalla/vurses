// Bundles the extension into dist/extension.js (CommonJS, `vscode` external).
import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')
const production = process.argv.includes('--production')
const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: !production,
  // keep function bodies intact: keys.ts is injected into the webview via toString()
  minify: false,
  logLevel: 'info',
}
if (watch) await (await context(options)).watch()
else await build(options)
