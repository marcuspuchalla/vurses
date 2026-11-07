import type { Command } from '../shared.js'

// placeholder — implemented by its owning work stream
const command: Command = {
  summary: '(not implemented yet)',
  usage: 'vuecli dev',
  run() {
    console.error('vuecli dev: not implemented yet')
    process.exit(1)
  },
}
export default command
