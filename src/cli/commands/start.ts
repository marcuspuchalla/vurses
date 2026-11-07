import type { Command } from '../shared.js'

// placeholder — implemented by its owning work stream
const command: Command = {
  summary: '(not implemented yet)',
  usage: 'vuecli start',
  run() {
    console.error('vuecli start: not implemented yet')
    process.exit(1)
  },
}
export default command
