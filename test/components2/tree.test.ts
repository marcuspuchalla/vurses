import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { render } from '../../src/testing.js'
import type { TreeNode } from '../../src/components/tree.js'
import { tpl } from './helpers.js'

const files = (): TreeNode[] => [
  {
    label: 'src',
    value: 'src',
    expanded: true,
    children: [
      { label: 'components', value: 'src/components', children: [{ label: 'Tree.ts', value: 'Tree.ts' }, { label: 'Code.ts', value: 'Code.ts' }] },
      { label: 'index.ts', value: 'index.ts' },
    ],
  },
  { label: 'package.json', value: 'package.json' },
]

describe('Tree', () => {
  it('renders guide lines and expand markers', async () => {
    const r = await render(tpl(`<Tree :nodes="nodes" expand-all />`, () => ({ nodes: files() })), { columns: 30, rows: 8 })
    expect(r.lastFrame()).toBe(['▾ src', '├─▾ components', '│ ├── Tree.ts', '│ └── Code.ts', '└── index.ts', '  package.json'].join('\n'))
  })

  it('expands / collapses with right/left and moves to the parent', async () => {
    const toggles: [string, boolean][] = []
    const r = await render(tpl(`<Tree :nodes="nodes" @toggle="(n, o) => t.push([n.label, o])" />`, () => ({ nodes: files(), t: toggles })), { columns: 30, rows: 8 })
    expect(r.lastFrame()).not.toContain('Tree.ts')
    await r.press('down', 'right')
    expect(r.lastFrame()).toContain('Tree.ts')
    expect(toggles).toEqual([['components', true]])
    await r.press('right', 'down') // into first child, then next
    await r.press('left') // leaf: go to parent
    await r.press('left') // collapse parent
    expect(r.lastFrame()).not.toContain('Tree.ts')
    expect(toggles).toEqual([['components', true], ['components', false]])
  })

  it('selects with enter (v-model) and toggles with space', async () => {
    const sel = ref<unknown>()
    const selected: string[] = []
    const r = await render(tpl(`<Tree :nodes="nodes" v-model="sel" @select="(n) => s.push(n.label)" />`, () => ({ nodes: files(), sel, s: selected })), { columns: 30, rows: 8 })
    await r.press('down', 'down', 'enter')
    expect(sel.value).toBe('index.ts')
    expect(selected).toEqual(['index.ts'])
    await r.press('up', 'space')
    expect(r.lastFrame()).toContain('Code.ts')
    expect(sel.value).toBe('index.ts')
    await r.press('home', 'space')
    expect(r.lastFrame()).toBe('▸ src\n  package.json')
  })

  it('toggles a branch on click', async () => {
    const r = await render(tpl(`<Tree :nodes="nodes" />`, () => ({ nodes: files() })), { columns: 30, rows: 8 })
    const at = r.locate('components')!
    await r.click(at.x, at.y)
    expect(r.lastFrame()).toContain('Tree.ts')
  })

  it('virtual scrolls with height', async () => {
    const nodes = Array.from({ length: 50 }, (_, i) => ({ label: `item ${i}` }))
    const r = await render(tpl(`<Tree :nodes="nodes" :height="5" />`, () => ({ nodes })), { columns: 20, rows: 6 })
    expect(r.lastFrame().split('\n')).toHaveLength(5)
    await r.press('end')
    expect(r.lastFrame()).toContain('item 49')
    expect(r.lastFrame()).not.toContain('item 0 ')
    await r.press('pageup')
    expect(r.lastFrame()).toContain('item 44')
  })

  it('renders custom labels through the #label slot', async () => {
    const r = await render(tpl(`<Tree :nodes="nodes" expand-all><template #label="{ node, depth }"><Text>{{ node.label.toUpperCase() }}@{{ depth }}</Text></template></Tree>`, () => ({ nodes: files() })), { columns: 30, rows: 8 })
    expect(r.lastFrame()).toContain('TREE.TS@2')
  })

  it('supports controlled expansion (v-model:expanded) and icons', async () => {
    const expanded = ref<unknown[]>(['src'])
    const nodes: TreeNode[] = [{ label: 'src', value: 'src', icon: '📁', children: [{ label: 'a.ts', icon: '📄' }] }]
    const r = await render(tpl(`<Tree :nodes="nodes" v-model:expanded="expanded" />`, () => ({ nodes, expanded })), { columns: 30, rows: 4 })
    expect(r.lastFrame()).toContain('📄 a.ts')
    await r.press('left')
    expect(expanded.value).toEqual([])
    expect(r.lastFrame()).toBe('▸ 📁 src')
  })
})
