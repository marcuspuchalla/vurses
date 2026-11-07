import { defineComponent } from 'vue'
import { redirect } from '../../../../../src/router/errors.js'
export default defineComponent({ name: 'GoHome', setup() { redirect('/about') } })
