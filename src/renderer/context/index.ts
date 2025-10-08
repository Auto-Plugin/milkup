import type { Ref } from 'vue'
import { createContext } from '@renderer/shared/createContext'
import { defineComponent, ref } from 'vue'

interface MilkupContext {
  isCollapsed: Ref<boolean>
  collapse: () => void
  expand: () => void
  toggleCollapse: () => void
}

const [useMilkup, provideContext] = createContext<MilkupContext>('Milkup')

function initState() {
  const isCollapsed = ref(false)

  function collapse() {
    isCollapsed.value = true
  }

  function expand() {
    isCollapsed.value = false
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value
  }

  provideContext({
    isCollapsed,
    collapse,
    expand,
    toggleCollapse,
  })
}

const MilkupProvider = defineComponent((_, { slots }) => {
  initState()

  return () => slots.default?.()
})

export {
  MilkupProvider,
  useMilkup,
}
