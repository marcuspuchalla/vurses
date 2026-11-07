/**
 * Page chrome shared by the client bundle and the frame player: the
 * "DOM view" toggle (remembered in localStorage, or forced with `?view=dom`
 * / `?view=console`) and a status line.
 */
export interface PageChrome {
  /** Current DOM view state. */
  readonly dom: boolean
  /** Mount point for the DOM view. */
  readonly root: HTMLElement
  status(text: string): void
}

const KEY = 'vuecli:view'

export function setupPageChrome(onToggle: (dom: boolean) => void, doc: Document = (globalThis as any).document): PageChrome {
  const root = doc.getElementById('vuecli-root') ?? doc.body
  const btn = doc.getElementById('vuecli-toggle')
  const statusEl = doc.getElementById('vuecli-status')
  let dom = false
  try {
    const q = new URLSearchParams(doc.location?.search ?? '').get('view')
    dom = q ? q === 'dom' : localStorage.getItem(KEY) === 'dom'
  } catch {
    /* storage blocked */
  }
  const label = () => {
    if (btn) btn.textContent = dom ? 'Hide DOM view' : 'DOM view'
  }
  label()
  btn?.addEventListener('click', (e) => {
    e.stopPropagation()
    dom = !dom
    try {
      localStorage.setItem(KEY, dom ? 'dom' : 'console')
    } catch {
      /* ignore */
    }
    label()
    onToggle(dom)
    ;(doc.querySelector('textarea[data-vuecli-input]') as HTMLTextAreaElement | null)?.focus()
  })
  return {
    get dom() {
      return dom
    },
    root,
    status(text) {
      if (statusEl) statusEl.textContent = text
    },
  }
}
