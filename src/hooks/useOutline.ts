import { onMounted, onUnmounted, ref } from 'vue'
import emitter from '@/renderer/events'

const isShowOutline = ref(false)
function toggleShowOutline() {
  isShowOutline.value = !isShowOutline.value
}
export default function useOutline() {
  const outline = ref<{ id: string, level: number, text: string }[]>([] as any)
  onMounted(() => {
    emitter.on('outline:Update', setOutline)
  })
  onUnmounted(() => {
    emitter.off('outline:Update', setOutline)
  })
  function setOutline(headings: any) {
    outline.value = headings
  }

  return {
    outline,
    isShowOutline,
  }
}
export { isShowOutline, toggleShowOutline }
