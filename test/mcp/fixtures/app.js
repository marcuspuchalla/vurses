// Small fixture app for the MCP tests (plain JS: no SFC loader needed).
import { defineComponent, h, ref, onMounted } from 'vue'

export const Counter = defineComponent({
  name: 'Counter',
  props: { step: { type: Number, default: 1 } },
  setup(props) {
    const count = ref(0)
    return { count, inc: () => (count.value += props.step) }
  },
  template: `<Box class="gap-1"><Text bold color="red">Count: {{ count }}</Text><Button label="Add" @click="inc" /></Box>`,
})

export default defineComponent({
  name: 'FixtureApp',
  components: { Counter },
  setup() {
    const name = ref('')
    const submitted = ref('')
    const pasted = ref('')
    const scrolled = ref(0)
    const later = ref(false)
    const lastKey = ref('')
    onMounted(() => {
      console.log('fixture mounted')
      console.warn('a warning')
      setTimeout(() => (later.value = true), 60)
    })
    return {
      name, submitted, pasted, scrolled, later, lastKey,
      submit: () => (submitted.value = name.value),
      onWheel: (e) => (scrolled.value += e.direction === 'down' ? 1 : -1),
    }
  },
  template: `<Box class="flex-col" :width="40">
    <Text>Hello MCP</Text>
    <Counter :step="2" />
    <TextInput v-model="name" placeholder="name" auto-focus @submit="submit" />
    <Text>Submitted: {{ submitted }}</Text>
    <Box :height="1" @wheel="onWheel"><Text>Scroll: {{ scrolled }}</Text></Box>
    <Text v-if="later">Loaded later</Text>
  </Box>`,
})
