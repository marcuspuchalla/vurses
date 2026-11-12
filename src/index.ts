// Runtime
export { createApp, run, Runtime } from './app/app.js'
export type { TuiApp, MountOptions } from './app/app.js'
export { render, compilerOptions, TERMINAL_TAGS } from './renderer.js'
export type { AppContext, LogEntry, FrameStats } from './app/context.js'
export { APP_CONTEXT } from './app/context.js'
export { FocusManager } from './app/focus.js'

// Composables
export {
  useApp,
  useAppContext,
  useTerminalSize,
  useTheme,
  useInput,
  useKeymap,
  useFocus,
  useFocusManager,
  useInterval,
  useTicker,
  useLogs,
  useFrameStats,
} from './composables.js'
export type { UseFocusOptions, UseFocusReturn, UseInputOptions, Keymap } from './composables.js'

// Components
export * from './components/index.js'
// template types for the globally registered components (Volar / vue-tsc)
export type {} from './components/global-types.js'

// Input
export { matchKey, formatKey, InputParser, createKeyEvent } from './input/keys.js'
export type { KeyEvent, MouseEvent, InputEvent } from './input/keys.js'

// Styling
export { darkTheme, lightTheme, draculaTheme, themes, defineTheme } from './style/theme.js'
export type { Theme } from './style/theme.js'
export { parseColor, mix } from './style/colors.js'
export type { Style, Dimension, BorderStyle } from './style/style.js'
export { parseClasses } from './style/classes.js'

// Low level
export { TElement, TTextNode, TComment } from './dom/nodes.js'
export type { LayoutInfo, TNode } from './dom/nodes.js'
export { CellBuffer, diffBuffers } from './render/buffer.js'
export { Painter } from './render/paint.js'
export { textWidth } from './render/text.js'

// App Router (file-system routes, layouts, Link, middleware)
export * from './router/index.js'

// Data cache & revalidation (server stream)
export { cache, unstable_cache, cached, revalidateTag, revalidatePath, updateTag, setCacheStore, getCacheStore, createMemoryStore, clearCache } from './cache/index.js'
export type { CacheStore, CacheEntry, CacheOptions } from './cache/index.js'

// Error codes (VC###, see docs/errors.md)
export { VuecliError, vuecliError, isVuecliError, vuecliWarn, formatError, errorDocsUrl, listErrors, ERRORS as VUECLI_ERRORS } from './errors.js'
export type { VuecliErrorCode, ErrorDefinition } from './errors.js'

// Devtools hook + `vuecli` console REPL
export { installDevtoolsHook, getDevtoolsHook } from './devtools/hook.js'
export type { DevtoolsHook, FrameRecord, DevtoolsState } from './devtools/hook.js'
export type { FrameSnapshot, FrameRun } from './devtools/frame.js'
