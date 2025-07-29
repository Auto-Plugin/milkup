import mitt from 'mitt'

interface Events {
  'file:Change': void // Triggered when a file is changed
  'spellcheck:Update': boolean // Triggered when spellcheck is updated
  'outline:Update': Array<{ text: string, level: number, id: string }> // Triggered when the outline is updated
}

const emitter = mitt<Events>()

export default emitter
