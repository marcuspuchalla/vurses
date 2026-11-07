// Plain JavaScript, no build step: `node examples/counter.js`
import { ref } from 'vue'
import { createApp, useApp, useKeymap } from 'vuecli'

const App = {
  setup() {
    const count = ref(0)
    const { exit } = useApp()
    useKeymap({ up: () => count.value++, down: () => count.value--, q: () => exit() })
    return { count }
  },
  template: `
    <Center>
      <Box border="round" title="counter" class="flex-col items-center px-4 py-1 gap-1">
        <BigText :text="String(count)" color="accent" />
        <Box class="gap-1">
          <Button label="−" @click="count--" />
          <Button label="+" variant="primary" @click="count++" />
        </Box>
        <Text color="muted">↑/↓ or click · q to quit</Text>
      </Box>
    </Center>
  `,
}

await createApp(App).mount().waitUntilExit()
