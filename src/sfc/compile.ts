import { createHash } from 'node:crypto'
import { transformSync } from 'esbuild'
import { compileScript, compileTemplate, generateCodeFrame, parse } from 'vue/compiler-sfc'
import { compilerOptions } from '../compiler-options.js'
import { vursesError } from '../errors.js'

/**
 * Compiles a Vue single-file component into an ES module for the terminal
 * renderer. `<style>` blocks are ignored (style with props/classes instead).
 */
const warnedStyles = new Set<string>()

export function compileSFC(source: string, filename: string): string {
  const { descriptor, errors } = parse(source, {
    filename,
    sourceMap: false,
    // the template AST is reused by compileScript, so parse with terminal rules
    templateParseOptions: { whitespace: compilerOptions.whitespace, isCustomElement: compilerOptions.isCustomElement },
  })
  if (errors.length) {
    const e = errors[0] as Error & { loc?: { start: { line: number; column: number; offset: number }; end: { offset: number } } }
    const where = e.loc ? `${filename}:${e.loc.start.line}:${e.loc.start.column}` : filename
    const frame = e.loc ? '\n' + generateCodeFrame(source, e.loc.start.offset, e.loc.end.offset) : ''
    throw vursesError('VC030', { file: where, reason: (e instanceof Error ? e.message : String(e)) + frame })
  }
  if (descriptor.styles.length && !warnedStyles.has(filename)) {
    // every Vue developer writes <style> first: say why nothing happens
    warnedStyles.add(filename)
    process.stderr.write(`vurses: ${filename}: <style> blocks are ignored in the terminal; style with classes (class="p-1 bold") or props instead.\n`)
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
    if (t.errors.length) throw vursesError('VC031', { file: filename, reason: String(t.errors[0]) })
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
