import { computed, ref } from 'vue'
import { setTitle } from '@/renderer/services'
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
  setTitle(`${prefix}${name}`)
  title.value = `${prefix}${name}`
}

export default function useTitle() {
  return {
    title,
    updateTitle,
  }
}
