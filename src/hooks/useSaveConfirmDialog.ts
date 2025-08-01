import { ref } from 'vue'

export function useSaveConfirmDialog() {
  const isDialogVisible = ref(false)
  const resolvePromise = ref<((value: 'save' | 'discard' | 'cancel') => void) | null>(null)

  const showDialog = (): Promise<'save' | 'discard' | 'cancel'> => {
    return new Promise((resolve) => {
      isDialogVisible.value = true
      resolvePromise.value = resolve
    })
  }

  const handleSave = () => {
    isDialogVisible.value = false
    if (resolvePromise.value) {
      resolvePromise.value('save')
      resolvePromise.value = null
    }
  }

  const handleDiscard = () => {
    isDialogVisible.value = false
    if (resolvePromise.value) {
      resolvePromise.value('discard')
      resolvePromise.value = null
    }
  }

  const handleCancel = () => {
    isDialogVisible.value = false
    if (resolvePromise.value) {
      resolvePromise.value('cancel')
      resolvePromise.value = null
    }
  }

  return {
    isDialogVisible,
    showDialog,
    handleSave,
    handleDiscard,
    handleCancel,
  }
}
