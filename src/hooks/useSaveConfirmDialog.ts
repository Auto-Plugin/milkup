import { ref } from 'vue'

type DialogType = 'close' | 'overwrite'
type CloseChoice = 'save' | 'discard' | 'cancel'
type OverwriteChoice = 'save' | 'overwrite' | 'cancel'

export function useSaveConfirmDialog() {
  const isDialogVisible = ref(false)
  const dialogType = ref<DialogType>('close')
  const fileName = ref<string | undefined>()
  const tabName = ref<string | undefined>()
  const resolvePromise = ref<((value: CloseChoice | OverwriteChoice) => void) | null>(null)

  const showDialog = (currentTabName?: string): Promise<CloseChoice> => {
    return new Promise((resolve) => {
      dialogType.value = 'close'
      tabName.value = currentTabName
      isDialogVisible.value = true
      resolvePromise.value = resolve as (value: CloseChoice | OverwriteChoice) => void
    })
  }

  const showOverwriteDialog = (file: string): Promise<OverwriteChoice> => {
    return new Promise((resolve) => {
      dialogType.value = 'overwrite'
      fileName.value = file
      isDialogVisible.value = true
      resolvePromise.value = resolve as (value: CloseChoice | OverwriteChoice) => void
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

  const handleOverwrite = () => {
    isDialogVisible.value = false
    if (resolvePromise.value) {
      resolvePromise.value('overwrite' as OverwriteChoice)
      resolvePromise.value = null
    }
  }

  return {
    isDialogVisible,
    dialogType,
    fileName,
    tabName,
    showDialog,
    showOverwriteDialog,
    handleSave,
    handleDiscard,
    handleCancel,
    handleOverwrite,
  }
}
