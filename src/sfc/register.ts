/** `node --import vuecli/register app.js` — enables importing `.vue` files. */
import { register } from 'node:module'

register('./hooks.js', import.meta.url)
