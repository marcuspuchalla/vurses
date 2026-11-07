import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { TElement } from '../dom/nodes.js'
import type { KeyEvent } from '../input/keys.js'
import type { Theme } from '../style/theme.js'
import type { FocusManager } from './focus.js'

export interface InputHandlerEntry {
  handler: (e: KeyEvent) => void
  active: () => boolean
  /** Higher priority handlers run first (dialogs use 100). */
  priority: number
  order: number
}

export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  message: string
  time: number
}

export interface FrameStats {
  frames: number
  /** Duration of the last layout + paint + diff, in ms. */
  lastFrameMs: number
  /** Bytes written for the last frame. */
  lastFrameBytes: number
  /** Number of rows changed in the last frame. */
  fps: number
}

export interface AppContext {
  root: TElement
  theme: ShallowRef<Theme>
  size: { columns: number; rows: number }
  focus: FocusManager
  inputHandlers: Set<InputHandlerEntry>
  logs: LogEntry[]
  stats: FrameStats
  devtools: Ref<boolean>
  exit(error?: unknown): void
  requestRender(): void
  setTheme(theme: Theme | string): void
  /** Writes raw output to the terminal (bypassing the renderer). */
  writeRaw(data: string): void
  /** The runtime instance (frames, input injection, resize, pause). */
  runtime: import('./app.js').Runtime
}

export const APP_CONTEXT: InjectionKey<AppContext> = Symbol('vuecli-app')
