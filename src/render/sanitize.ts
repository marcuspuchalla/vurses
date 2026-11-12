/**
 * Terminal output hygiene. Anything an app shows can come from untrusted data (API
 * responses, user input, v-html), and the terminal interprets control characters:
 * ESC / OSC sequences can set the clipboard (OSC 52), the window title, hyperlinks, or
 * repaint the screen. Text written to the terminal goes through one of these.
 */

/** C0 controls except tab and newline, DEL, and C1 controls (U+0080–U+009F). */
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g
/** All C0, DEL and C1 controls. */
const ALL_CONTROLS = /[\x00-\x1f\x7f-\x9f]/g

/**
 * Log lines and error messages printed to the terminal: control characters are shown
 * as visible escapes (`\x1b`), so a logged escape sequence is readable instead of executed.
 */
export function safeLogText(s: string): string {
  return s.replace(CONTROLS, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))
}

/** Window titles: no control characters at all (they would end the title sequence), length capped. */
export function safeTitle(s: string, max = 200): string {
  const t = s.replace(ALL_CONTROLS, '')
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/** True for a cell glyph that must never reach the terminal. */
export function isControlChar(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return c < 0x20 || (c >= 0x7f && c <= 0x9f)
}
