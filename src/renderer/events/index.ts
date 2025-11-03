import mitt from 'mitt'

type Events = {
  'file:Change': void // Triggered when a file is changed
  'spellcheck:Update': boolean // Triggered when spellcheck is updated
  'outline:Update': Array<{ text: string, level: number, id: string }> // Triggered when the outline is updated
  'close:confirm': void // Triggered when need to show close confirmation dialog
  'close:discard': void // Triggered when user chooses to discard changes
  'menu-save': boolean // Triggered when user wants to save
  'trigger-save': boolean // Triggered when main process requests save
  'tab:close-confirm': { tabId: string, tabName: string, isLastTab?: boolean } // Triggered when tab close confirmation is needed
  'tab:switch': { id: string, name: string, filePath: string | null, content: string, originalContent: string, isModified: boolean, scrollRatio?: number, readOnly: boolean } // Triggered when switching tabs
  'file:overwrite-confirm': { fileName: string, resolver: (choice: 'cancel' | 'save' | 'overwrite') => void } // Triggered when file overwrite confirmation is needed
  'update:available': { version: string, url: string, notes: string } // Triggered when an update is available
} & Record<string, unknown>

const emitter = mitt<Events>()

export default emitter
