import { computed, ref } from "vue";

const loadingCount = ref(0);
const loadingMessage = ref("");
const loadingStartedAt = ref(0);

const isLoading = computed(() => loadingCount.value > 0);

function showLoading(message = "加载中...") {
  loadingCount.value += 1;
  loadingMessage.value = message;
  if (loadingCount.value === 1) {
    loadingStartedAt.value = performance.now();
  }
}

async function hideLoading(minDurationMs = 0) {
  if (loadingCount.value > 0) {
    if (loadingCount.value === 1 && minDurationMs > 0) {
      const elapsed = performance.now() - loadingStartedAt.value;
      const remaining = minDurationMs - elapsed;
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
    }
    loadingCount.value -= 1;
  }
  if (loadingCount.value === 0) {
    loadingMessage.value = "";
    loadingStartedAt.value = 0;
  }
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

async function runWithLoading<T>(
  task: () => Promise<T> | T,
  message = "加载中...",
  minDurationMs = 180
): Promise<T> {
  showLoading(message);
  await nextFrame();
  try {
    return await task();
  } finally {
    await hideLoading(minDurationMs);
  }
}

export default function useUiLoading() {
  return {
    isLoading,
    loadingMessage,
    showLoading,
    hideLoading,
    nextFrame,
    runWithLoading,
  };
}
