import { it } from 'vitest'
import { getFigletFont, renderFiglet } from '../../src/fonts/index.js'
it('x', async () => {
  for (const f of ['standard','slant','small','mini']) for (const t of ['Hi', 'Hello', 'Vue CLI']) process.stdout.write(f+'\n'+renderFiglet(t, getFigletFont(f)!).join('|\n')+'|\n')
})
