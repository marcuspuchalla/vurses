import type { App, Component } from 'vue'
import { Box, Center, Divider, HStack, Newline, Spacer, Text, VStack } from './primitives.js'
import { Button, Checkbox, List, RadioGroup, ScrollbarTrack, Select, Switch, TextInput } from './inputs.js'
import { Badge, BarChart, KeyHints, ProgressBar, Sparkline, Spinner, Stat, StatusBar, Table } from './display.js'
import { CommandPalette, Dialog, DevTools, ScrollBox, Tabs } from './containers.js'
import { BigText } from './bigtext.js'
import { Markdown } from './markdown.js'

export * from './primitives.js'
export * from './inputs.js'
export * from './display.js'
export * from './containers.js'
export * from './bigtext.js'
export * from './markdown.js'

export const components: Record<string, Component> = {
  Box, Text, Newline, Spacer, Center, VStack, HStack, Divider,
  Button, TextInput, Checkbox, Switch, RadioGroup, List, Select, ScrollbarTrack,
  ProgressBar, Spinner, Sparkline, BarChart, Table, Badge, KeyHints, StatusBar, Stat,
  ScrollBox, Tabs, Dialog, CommandPalette, DevTools, BigText, Markdown,
}

/** Registers all built-in components globally (done automatically by createApp). */
export function installComponents(app: App) {
  for (const name in components) {
    if (!app.component(name)) app.component(name, components[name])
  }
}
