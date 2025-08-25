import type { Font } from '@/types/font'
import { ref } from 'vue'
import { defaultFontList } from '@/config/font'

const fontList = ref<(Font | Record<string, Font>)[]>([])

function init() {
  fontList.value.push(
    ...Object.values(defaultFontList),
  )
}

function setFont(fontName: string) {

}

function getFontList() {}

export default function useFont() {
  return {

    fontList,
    init,
    setFont,
  }
}
