import { nextTick, onMounted, ref } from "vue";

export default function useSpellCheck() {
  const isSpellCheckEnabled = ref(localStorage.getItem("spellcheck") === "true");

  function applySpellCheck(isEnabled: boolean) {
    isSpellCheckEnabled.value = isEnabled;
    nextTick(() => {
      const html = document.documentElement;
      if (isEnabled) {
        html.setAttribute("spellcheck", "true");
        localStorage.setItem("spellcheck", "true");
      } else {
        html.setAttribute("spellcheck", "false");
        localStorage.setItem("spellcheck", "false");
      }
    });
  }

  // Initialize on mount/creation
  applySpellCheck(isSpellCheckEnabled.value);

  onMounted(() => {
    const savedSpellCheck = localStorage.getItem("spellcheck");
    if (savedSpellCheck !== null) {
      // Logic above already sets initial state, but explicit check ensures sync
      const isEnabled = savedSpellCheck === "true";
      if (isEnabled !== isSpellCheckEnabled.value) {
        applySpellCheck(isEnabled);
      }
    }
  });

  return {
    isSpellCheckEnabled,
    applySpellCheck,
  };
}
