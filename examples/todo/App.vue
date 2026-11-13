<template>
  <Box class="flex-col p-1 gap-1" :width="64">
    <BigText text="TODOS" color="primary" gradient="accent" />
    <TextInput v-model="draft" placeholder="What needs to be done? (enter to add)" auto-focus @submit="add" />

    <Box class="flex-col" border="round" :padding-x="1" :title="`${left} left`">
      <Box v-for="t in visible" :key="t.id" class="gap-1">
        <Checkbox v-model="t.done" :label="t.title" />
        <Spacer />
        <Button label="✕" variant="danger" :border="false" @click="remove(t)" />
      </Box>
      <Text v-if="!visible.length" color="muted">Nothing here 🎉</Text>
    </Box>

    <Box class="gap-2">
      <RadioGroup v-model="filter" horizontal :options="['all', 'active', 'done']" />
      <Spacer />
      <Text color="muted">ctrl+d clear done · esc quit</Text>
    </Box>
  </Box>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useApp, useKeymap } from 'vurses'

interface Todo { id: number; title: string; done: boolean }

const { exit } = useApp()
let id = 0
const todos = ref<Todo[]>([
  { id: ++id, title: 'Render Vue in the terminal', done: true },
  { id: ++id, title: 'Add flexbox layout', done: true },
  { id: ++id, title: 'Write the docs', done: false },
])
const draft = ref('')
const filter = ref<'all' | 'active' | 'done'>('all')
const visible = computed(() =>
  todos.value.filter((t) => (filter.value === 'all' ? true : filter.value === 'done' ? t.done : !t.done)),
)
const left = computed(() => todos.value.filter((t) => !t.done).length)

function add() {
  const title = draft.value.trim()
  if (title) todos.value.push({ id: ++id, title, done: false })
  draft.value = ''
}
function remove(t: Todo) {
  todos.value = todos.value.filter((x) => x !== t)
}

useKeymap({ escape: () => exit(), 'ctrl+d': () => (todos.value = todos.value.filter((t) => !t.done)) })
</script>
