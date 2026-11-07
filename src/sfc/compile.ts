import { createHash } from 'node:crypto'
import { transformSync } from 'esbuild'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'
import { compilerOptions } from '../compiler-options.js'

/**
 * Compiles a Vue single-file component into an ES module for the terminal
 * renderer. `<style>` blocks are ignored (style with props/classes instead).
 */
export function compileSFC(source: string, filename: string): string {
  const { descriptor, errors } = parse(source, {
    filename,
    sourceMap: false,
    // the template AST is reused by compileScript, so parse with terminal rules
    templateParseOptions: { whitespace: compilerOptions.whitespace, isCustomElement: compilerOptions.isCustomElement },
  })
  if (errors.length) {
    const e = errors[0]
    throw new SyntaxError(`[vuecli] ${filename}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const id = createHash('sha256').update(filename).digest('hex').slice(0, 8)
  const opts = { ...compilerOptions }
  let code = ''
  let lang = 'js'
  const script = descriptor.scriptSetup ?? descriptor.script
  if (script) {
    const compiled = compileScript(descriptor, {
      id,
      inlineTemplate: !!descriptor.scriptSetup,
      genDefaultAs: '_sfc_main',
      templateOptions: { compilerOptions: opts },
    })
    code += compiled.content + '\n'
    lang = script.lang ?? 'js'
  } else {
    code += 'const _sfc_main = {}\n'
  }
  if (descriptor.template && !descriptor.scriptSetup) {
    const t = compileTemplate({
      source: descriptor.template.content,
      filename,
      id,
      compilerOptions: opts,
    })
    if (t.errors.length) throw new SyntaxError(`[vuecli] ${filename}: ${String(t.errors[0])}`)
    code += t.code.replace(/export function render/, 'function _sfc_render') + '\n_sfc_main.render = _sfc_render\n'
  }
  code += `_sfc_main.__file = ${JSON.stringify(filename)}\nexport default _sfc_main\n`
  if (lang === 'ts' || lang === 'tsx') {
    code = transformSync(code, {
      loader: lang,
      format: 'esm',
      sourcefile: filename,
      sourcemap: 'inline',
      target: 'es2022',
    }).code
  }
  return code
}
