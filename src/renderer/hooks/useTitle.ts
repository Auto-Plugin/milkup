import { computed, ref } from 'vue'
import useContent from './useContent'

const { filePath, isModified } = useContent()

const title = ref('')

const fileName = computed(() => {
  const parts = filePath.value.split(/[\\/]/)
  return parts.at(-1) ?? ''
})

function updateTitle() {
  const name = (fileName.value || 'Untitled')
  const prefix = isModified.value ? '*' : ''
  window.electronAPI.setTitle(`${prefix}${name}`)
  title.value = `${prefix}${name}`
}

export default function useTitle() {
  return {
    title,
    updateTitle,
  }
}
