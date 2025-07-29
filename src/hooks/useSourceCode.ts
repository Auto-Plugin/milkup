import { ref } from 'vue'

const isShowSource = ref(false)
export default function useSourceCode() {
  const toggleSourceCode = () => {
    isShowSource.value = !isShowSource.value
  }

  return {
    isShowSource,
    toggleSourceCode,
  }
}
