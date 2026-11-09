import './app.css'
import { createApp, ref, computed } from 'vue'

const App = {
  setup() {
    const items = ref([
      { name: 'Apple', price: 2 },
      { name: 'Pear', price: 3 },
    ])
    const name = ref('')
    const express = ref(false)
    const log = ref('')
    const total = computed(() => items.value.reduce((s, i) => s + i.price, 0) + (express.value ? 5 : 0))
    const add = () => {
      if (!name.value.trim()) return
      items.value.push({ name: name.value.trim(), price: 1 })
      name.value = ''
      log.value = 'added'
    }
    return { items, name, express, total, add, log }
  },
  template: `
    <main>
      <h1 class="title">Basket</h1>
      <p>Welcome to the <a href="#/about">fixture</a> shop. Prices in <em>euro</em>.</p>
      <ul class="items">
        <li v-for="i in items" :key="i.name"><span>{{ i.name }}</span><span class="price">{{ i.price }} €</span></li>
      </ul>
      <form @submit.prevent="add">
        <input v-model="name" placeholder="New item">
        <button>Add</button>
      </form>
      <label><input type="checkbox" v-model="express"> Express delivery</label>
      <p class="total">Total: {{ total }} €</p>
      <p class="hidden-on-terminal">never shown</p>
      <p class="wide-only">wide screens only</p>
      <p class="scheme">scheme</p>
      <p v-if="log">Log: {{ log }}</p>
    </main>`,
}

createApp(App).mount('#app')
