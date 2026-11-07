/**
 * Remote stream target: a headless RenderTarget that turns every presented
 * frame into a `FrameDelta` (row deltas + interned styles) for a frame
 * player. Used by server-side sessions (src/server/session.ts); transport-agnostic.
 */
import type { RenderTarget } from '../app/target.js'
import { DeltaEncoder, type FrameDelta } from './protocol.js'

export interface StreamTargetOptions {
  columns: number
  rows: number
  /** Receives each non-empty delta. Return value is ignored. */
  send(delta: FrameDelta, json: string): void
}

export interface StreamTarget extends RenderTarget {
  /** Next frame is sent in full (e.g. after the client reconnected). */
  resync(): void
  readonly encoder: DeltaEncoder
}

export function streamTarget(options: StreamTargetOptions): StreamTarget {
  const encoder = new DeltaEncoder()
  return {
    columns: options.columns,
    rows: options.rows,
    colorDepth: 'truecolor',
    encoder,
    resync() {
      encoder.reset()
    },
    frame(next) {
      const delta = encoder.encode(next)
      if (!delta) return 0
      const json = JSON.stringify(delta)
      options.send(delta, json)
      return json.length
    },
  }
}
