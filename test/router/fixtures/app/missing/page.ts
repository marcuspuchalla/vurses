import { defineComponent } from 'vue'
import { notFound } from '../../../../../src/router/errors.js'
export default defineComponent({ name: 'Missing', setup() { notFound() } })
