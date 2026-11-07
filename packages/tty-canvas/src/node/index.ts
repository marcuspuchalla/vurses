/**
 * Node-only entry point (`tty-canvas/node`): run existing HTML/JS canvas
 * code and play canvases full-screen in the terminal. Re-exports the core.
 */
export * from '../index.js'
export { runHtml, runScript, type Page, type RunOptions } from './runner.js'
export { play, type PlayOptions, type Player, type PlayMode } from './terminal.js'
export { InputParser, type TermInput, type TermKey, type TermMouse } from './input.js'
export { parseHtml } from './html.js'
