import { nextTick, onMounted, ref } from 'vue'

function applySpellCheck(isEnabled: boolean) {
  nextTick(() => {
    const html = document.documentElement
    if (isEnabled) {
      html.setAttribute('spellcheck', 'true')
      localStorage.setItem('spellcheck', 'true')
    }
    else {
      html.setAttribute('spellcheck', 'false')
      localStorage.setItem('spellcheck', 'false')
    }
  })
}

export default function useSpellCheck() {
  const isSpellCheckEnabled = ref(localStorage.getItem('spellcheck') === 'true')
  applySpellCheck(isSpellCheckEnabled.value)
  onMounted(() => {
    const savedSpellCheck = localStorage.getItem('spellcheck')
    if (savedSpellCheck) {
      isSpellCheckEnabled.value = savedSpellCheck === 'true'
      applySpellCheck(isSpellCheckEnabled.value)
    }
  })
  return {
    isSpellCheckEnabled,
    applySpellCheck,
  }
}
