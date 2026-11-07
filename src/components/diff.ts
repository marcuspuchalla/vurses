import { computed, defineComponent, h, type PropType, type VNodeChild } from 'vue'
import { useTheme } from '../composables.js'
import { mix } from '../style/colors.js'
import { resolveColorHex } from './gradient.js'

// ------------------------------------------------------------------ algorithm

export type DiffOp = { type: 'equal' | 'delete' | 'insert'; a: number; b: number }

/**
 * Myers' O(ND) diff. Returns the edit script over two sequences as a list of
 * operations (`a` / `b` are indices into the old / new sequence).
 */
export function myersDiff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): DiffOp[] {
  // trim common prefix / suffix (cheap and makes the core much smaller)
  let start = 0
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = n === 0 && m === 0
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && eq(a[start + x], b[start + y])) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  // backtrack
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vv[offset + k - 1] < vv[offset + k + 1]) ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : vv[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      ops.push({ type: 'equal', a: start + x, b: start + y })
    }
    if (d === 0) break
    if (x === prevX) {
      y--
      ops.push({ type: 'insert', a: start + x, b: start + y })
    } else {
      x--
      ops.push({ type: 'delete', a: start + x, b: start + y })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    ops.push({ type: 'equal', a: start + x, b: start + y })
  }
  ops.reverse()
  const head: DiffOp[] = []
  for (let i = 0; i < start; i++) head.push({ type: 'equal', a: i, b: i })
  const tail: DiffOp[] = []
  for (let i = 0; i < a.length - endA; i++) tail.push({ type: 'equal', a: endA + i, b: endB + i })
  return [...head, ...ops, ...tail]
}

export interface DiffLine {
  type: 'context' | 'add' | 'del'
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Text after the second `@@` (function context). */
  section?: string
  lines: DiffLine[]
}

export interface DiffFile {
  oldName?: string
  newName?: string
  hunks: DiffHunk[]
}

const splitLines = (s: string) => {
  const l = s.replace(/\r\n?/g, '\n').split('\n')
  if (l.length > 1 && l[l.length - 1] === '') l.pop()
  return l
}

/** Line diff of two texts, grouped into hunks with `context` unchanged lines around changes. */
export function diffLines(oldText: string, newText: string, context = 3): DiffHunk[] {
  const a = oldText === '' ? [] : splitLines(oldText)
  const b = newText === '' ? [] : splitLines(newText)
  const ops = myersDiff(a, b)
  const all: DiffLine[] = ops.map((o) =>
    o.type === 'equal'
      ? { type: 'context', text: a[o.a], oldNo: o.a + 1, newNo: o.b + 1 }
      : o.type === 'delete'
        ? { type: 'del', text: a[o.a], oldNo: o.a + 1 }
        : { type: 'add', text: b[o.b], newNo: o.b + 1 },
  )
  if (!all.some((l) => l.type !== 'context')) return []
  const ctx = Number.isFinite(context) ? Math.max(0, context) : Infinity
  // mark lines to keep
  const keep = new Array(all.length).fill(false)
  all.forEach((l, i) => {
    if (l.type === 'context') return
    const lo = Math.max(0, i - ctx)
    const hi = Math.min(all.length - 1, i + ctx)
    for (let j = lo; j <= hi; j++) keep[j] = true
  })
  const hunks: DiffHunk[] = []
  let from = -1
  const close = (to: number) => {
    const lines = all.slice(from, to)
    const oldLines = lines.filter((l) => l.type !== 'add').length
    const newLines = lines.filter((l) => l.type !== 'del').length
    // ops carry the position in both sequences; an empty side reports the line before
    const first = ops[from]
    hunks.push({ oldStart: oldLines ? first.a + 1 : first.a, oldLines, newStart: newLines ? first.b + 1 : first.b, newLines, lines })
    from = -1
  }
  all.forEach((_, i) => {
    if (keep[i]) {
      if (from < 0) from = i
    } else if (from >= 0) close(i)
  })
  if (from >= 0) close(all.length)
  return hunks
}

/** Parses a unified diff (`git diff` / `diff -u` output; multiple files supported). */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  const ensureFile = () => {
    if (!file) {
      file = { hunks: [] }
      files.push(file)
    }
    return file
  }
  for (const line of splitLines(text)) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      file = { oldName: m?.[1], newName: m?.[2], hunks: [] }
      files.push(file)
      hunk = null
      continue
    }
    if (line.startsWith('--- ') && (!hunk || hunk.lines.length >= hunk.oldLines + hunk.newLines)) {
      if (file && (file as DiffFile).hunks.length) {
        file = null
      }
      const f = ensureFile()
      f.oldName = line.slice(4).replace(/^a\//, '').replace(/\t.*$/, '')
      hunk = null
      continue
    }
    if (line.startsWith('+++ ') && !hunk) {
      ensureFile().newName = line.slice(4).replace(/^b\//, '').replace(/\t.*$/, '')
      continue
    }
    const hm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line)
    if (hm) {
      hunk = {
        oldStart: +hm[1],
        oldLines: hm[2] === undefined ? 1 : +hm[2],
        newStart: +hm[3],
        newLines: hm[4] === undefined ? 1 : +hm[4],
        section: hm[5] || undefined,
        lines: [],
      }
      ensureFile().hunks.push(hunk)
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      continue
    }
    if (!hunk) continue
    const c = line[0]
    if (c === '+') hunk.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ })
    else if (c === '-') hunk.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ })
    else if (c === ' ' || line === '') hunk.lines.push({ type: 'context', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    // '\ No newline at end of file' and other metadata lines are ignored
  }
  return files
}

export interface WordSegment {
  text: string
  changed: boolean
}

const wordTokens = (s: string) => s.match(/\w+|\s+|[^\w\s]/g) ?? []

/** Word-level diff of a changed line pair (for intra-line highlights). */
export function diffWords(oldLine: string, newLine: string): { old: WordSegment[]; new: WordSegment[] } {
  const a = wordTokens(oldLine)
  const b = wordTokens(newLine)
  const ops = myersDiff(a, b)
  const o: WordSegment[] = []
  const n: WordSegment[] = []
  const add = (arr: WordSegment[], text: string, changed: boolean) => {
    const last = arr[arr.length - 1]
    if (last && last.changed === changed) last.text += text
    else arr.push({ text, changed })
  }
  for (const op of ops) {
    if (op.type === 'equal') {
      add(o, a[op.a], false)
      add(n, b[op.b], false)
    } else if (op.type === 'delete') add(o, a[op.a], true)
    else add(n, b[op.b], true)
  }
  return { old: o, new: n }
}

// ------------------------------------------------------------------ component

interface Row {
  kind: 'line' | 'hunk' | 'file'
  line?: DiffLine
  /** Split view: right side. */
  right?: DiffLine
  words?: WordSegment[]
  rightWords?: WordSegment[]
  text?: string
}

/** Pairs consecutive deletions with following insertions (for word diffs and split view). */
function pairChanges(lines: DiffLine[]): { dels: DiffLine[]; adds: DiffLine[]; context?: DiffLine }[] {
  const out: { dels: DiffLine[]; adds: DiffLine[]; context?: DiffLine }[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.type === 'context') {
      out.push({ dels: [], adds: [], context: l })
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
    out.push({ dels, adds })
  }
  return out
}

/**
 * Renders a diff, from a unified diff string or two texts.
 *   <Diff :old="before" :new="after" filename="app.ts" word-diff />
 *   <Diff :diff="gitDiffOutput" split />
 */
export const Diff = defineComponent({
  name: 'Diff',
  props: {
    /** Unified diff text. */
    diff: { type: String, default: undefined },
    old: { type: String, default: undefined },
    new: { type: String, default: undefined },
    filename: String,
    /** Unchanged lines around changes (`Infinity` shows the whole file). */
    context: { type: Number, default: 3 },
    /** Side-by-side view. */
    split: Boolean,
    lineNumbers: { type: Boolean, default: true },
    /** Highlight changed words inside modified lines. */
    wordDiff: Boolean,
    border: { type: String, default: 'round' },
    title: String,
  },
  setup(props) {
    const theme = useTheme()
    const files = computed<DiffFile[]>(() => {
      if (props.diff !== undefined) return parseUnifiedDiff(props.diff)
      return [{ oldName: props.filename, newName: props.filename, hunks: diffLines(props.old ?? '', props.new ?? '', props.context) }]
    })
    const stats = computed(() => {
      let add = 0
      let del = 0
      for (const f of files.value) for (const hk of f.hunks) for (const l of hk.lines) l.type === 'add' ? add++ : l.type === 'del' ? del++ : 0
      return { add, del }
    })
    const colors = computed(() => {
      const th = theme.value
      const base = resolveColorHex(th.background, th) ?? resolveColorHex(th.surface, th) ?? '#000000'
      const ok = resolveColorHex('success', th) ?? '#00aa00'
      const bad = resolveColorHex('error', th) ?? '#aa0000'
      return {
        addBg: th['diff.addBg'] ?? mix(base, ok, 0.18),
        delBg: th['diff.delBg'] ?? mix(base, bad, 0.18),
        addWord: th['diff.addWordBg'] ?? mix(base, ok, 0.42),
        delWord: th['diff.delWordBg'] ?? mix(base, bad, 0.42),
      }
    })

    const buildRows = (file: DiffFile, multi: boolean): Row[] => {
      const rows: Row[] = []
      if (multi) {
        const name = file.oldName && file.newName && file.oldName !== file.newName && file.oldName !== '/dev/null' && file.newName !== '/dev/null' ? `${file.oldName} → ${file.newName}` : file.newName !== '/dev/null' ? file.newName : file.oldName
        rows.push({ kind: 'file', text: name ?? '' })
      }
      for (const hk of file.hunks) {
        rows.push({ kind: 'hunk', text: `@@ -${hk.oldStart},${hk.oldLines} +${hk.newStart},${hk.newLines} @@${hk.section ? ' ' + hk.section : ''}` })
        for (const g of pairChanges(hk.lines)) {
          if (g.context) {
            rows.push({ kind: 'line', line: g.context, right: g.context })
            continue
          }
          const words = props.wordDiff ? g.dels.map((d, i) => (g.adds[i] ? diffWords(d.text, g.adds[i].text) : null)) : []
          if (props.split) {
            const n = Math.max(g.dels.length, g.adds.length)
            for (let i = 0; i < n; i++) rows.push({ kind: 'line', line: g.dels[i], right: g.adds[i], words: words[i]?.old, rightWords: words[i]?.new })
          } else {
            g.dels.forEach((d, i) => rows.push({ kind: 'line', line: d, words: words[i]?.old }))
            g.adds.forEach((a, i) => rows.push({ kind: 'line', line: a, words: words[i]?.new }))
          }
        }
      }
      return rows
    }

    return () => {
      const fs = files.value
      const c = colors.value
      let oldW = 1
      let newW = 1
      for (const f of fs)
        for (const hk of f.hunks) {
          oldW = Math.max(oldW, String(hk.oldStart + hk.oldLines).length)
          newW = Math.max(newW, String(hk.newStart + hk.newLines).length)
        }
      const content = (l: DiffLine | undefined, words: WordSegment[] | undefined): VNodeChild[] => {
        if (!l) return []
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '
        const color = l.type === 'add' ? 'success' : l.type === 'del' ? 'error' : undefined
        const wordBg = l.type === 'add' ? c.addWord : c.delWord
        const body: VNodeChild[] = words
          ? words.map((w) => h('tui-text', { bg: w.changed ? wordBg : undefined, bold: w.changed || undefined }, w.text))
          : [l.text]
        return [h('tui-text', { color, bold: l.type !== 'context' }, sign + ' '), h('tui-text', { color }, body.length ? body : [''])]
      }
      const bgOf = (l: DiffLine | undefined) => (l?.type === 'add' ? c.addBg : l?.type === 'del' ? c.delBg : undefined)
      const gutter = (n: number | undefined, w: number) => (n === undefined ? ' '.repeat(w) : String(n).padStart(w))
      const children: VNodeChild[] = []
      let key = 0
      for (const f of fs) {
        for (const r of buildRows(f, fs.length > 1)) {
          if (r.kind === 'file') {
            children.push(h('tui-text', { key: key++, bold: true, color: 'text', wrap: 'truncate' }, [h('tui-text', { color: 'accent' }, '● '), r.text!]))
            continue
          }
          if (r.kind === 'hunk') {
            children.push(h('tui-text', { key: key++, color: 'info', dim: true, wrap: 'truncate' }, r.text!))
            continue
          }
          if (props.split) {
            const side = (l: DiffLine | undefined, words: WordSegment[] | undefined, isOld: boolean) =>
              h('tui-box', { flexDirection: 'row', flexGrow: 1, flexBasis: 0, flexShrink: 1, overflow: 'hidden', bg: l?.type === 'context' ? undefined : bgOf(l) }, [
                props.lineNumbers
                  ? h('tui-text', { color: 'muted', wrap: 'none', flexShrink: 0 }, gutter(isOld ? l?.oldNo : l?.newNo, isOld ? oldW : newW) + ' ')
                  : null,
                h('tui-text', { wrap: 'none' }, content(l, words)),
              ])
            children.push(
              h('tui-box', { key: key++, flexDirection: 'row', flexShrink: 0 }, [
                side(r.line, r.words, true),
                h('tui-text', { color: 'border', flexShrink: 0 }, '│'),
                side(r.right, r.rightWords, false),
              ]),
            )
            continue
          }
          const l = r.line!
          children.push(
            h('tui-box', { key: key++, flexDirection: 'row', flexShrink: 0, bg: bgOf(l) }, [
              props.lineNumbers
                ? h('tui-text', { color: 'muted', wrap: 'none', flexShrink: 0 }, `${gutter(l.oldNo, oldW)} ${gutter(l.newNo, newW)} `)
                : null,
              h('tui-text', { wrap: 'none' }, content(l, r.words)),
            ]),
          )
        }
      }
      if (!fs.some((f) => f.hunks.length)) children.push(h('tui-text', { color: 'muted' }, 'No changes'))
      const st = stats.value
      const title = props.title ?? (fs.length === 1 ? (fs[0].newName && fs[0].newName !== '/dev/null' ? fs[0].newName : fs[0].oldName) : undefined)
      const bordered = props.border !== 'none'
      return h('tui-box', { flexDirection: 'column', flexShrink: 0, border: props.border, borderColor: 'border', paddingX: bordered ? 1 : 0, title: title ? `${title}  +${st.add} -${st.del}` : `+${st.add} -${st.del}`, titleColor: 'muted' }, children)
    }
  },
})
