/**
 * Themes map semantic tokens (`primary`, `muted`, `surface`, ...) to concrete colors.
 * Any color prop accepts a token name; it is resolved at paint time, so switching
 * the theme re-colors the whole app instantly.
 */
export interface Theme {
  name: string
  /** Default foreground text color. */
  text: string
  /** Secondary, de-emphasized text. */
  muted: string
  /** App background. Use `'default'` to keep the terminal's own background. */
  background: string
  /** Raised surfaces: panels, dialogs, inputs. */
  surface: string
  /** Borders and dividers. */
  border: string
  /** Border color of the focused element. */
  focus: string
  primary: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  /** Background of the selected row in lists, tables, menus. */
  selection: string
  /** Extra user-defined tokens. */
  [token: string]: string
}

export const darkTheme: Theme = {
  name: 'dark',
  text: '#e6e6e6',
  muted: '#8b8b8b',
  background: 'default',
  surface: '#1f2430',
  border: '#4b5263',
  focus: '#42b883',
  primary: '#42b883',
  accent: '#7aa2f7',
  success: '#9ece6a',
  warning: '#e0af68',
  error: '#f7768e',
  info: '#7dcfff',
  selection: '#2d3f55',
}

export const lightTheme: Theme = {
  name: 'light',
  text: '#24292f',
  muted: '#6e7781',
  background: '#ffffff',
  surface: '#eef1f5',
  border: '#afb8c1',
  focus: '#2f8f62',
  primary: '#2f8f62',
  accent: '#0969da',
  success: '#1a7f37',
  warning: '#9a6700',
  error: '#cf222e',
  info: '#0550ae',
  selection: '#ddf4ff',
}

export const draculaTheme: Theme = {
  name: 'dracula',
  text: '#f8f8f2',
  muted: '#6272a4',
  background: '#282a36',
  surface: '#343746',
  border: '#6272a4',
  focus: '#ff79c6',
  primary: '#bd93f9',
  accent: '#ff79c6',
  success: '#50fa7b',
  warning: '#f1fa8c',
  error: '#ff5555',
  info: '#8be9fd',
  selection: '#44475a',
}

export const themes: Record<string, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  dracula: draculaTheme,
}

export function defineTheme(base: Theme, overrides: Partial<Theme> & { name: string }): Theme {
  return { ...base, ...overrides } as Theme
}
