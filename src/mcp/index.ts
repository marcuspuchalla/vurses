/**
 * vuecli MCP server and headless sessions (Node only).
 *
 *   import { createMcpServer, loadApp } from 'vuecli/mcp'
 */
export { createMcpServer } from './server.js'
export type { McpServerOptions, VuecliMcpServer } from './server.js'
export { HeadlessSession, parseKey } from './session.js'
export type { SessionOptions, ClickOptions } from './session.js'
export { loadApp, loadEntry, loadRouterApp, registerSfcHooks } from './load.js'
export type { LoadedApp, RouterLike } from './load.js'
export { servePreview, lineSplitter } from './jsonl.js'
export type { PreviewCommand, PreviewIO } from './jsonl.js'
