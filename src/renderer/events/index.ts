import mitt from 'mitt'

type Events = {
  'file:Change': void // Triggered when a file is changed
  'spellcheck:Update': boolean // Triggered when spellcheck is updated
  'outline:Update': Array<{ text: string, level: number, id: string }> // Triggered when the outline is updated
  'close:confirm': void // Triggered when need to show close confirmation dialog
  'close:discard': void // Triggered when user chooses to discard changes
  'menu-save': boolean // Triggered when user wants to save
  'trigger-save': boolean // Triggered when main process requests save
} & Record<string, unknown>

const emitter = mitt<Events>()

export default emitter
