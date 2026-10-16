import type { PdfExportProvider } from './scoped-export'

export type PdfFontEmbeddingMode = 'host-default' | 'prefer-embed' | 'require-embed'

export interface PdfFontStrategy {
  readonly fontFamilies?: readonly string[]
  readonly fallbackFamilies?: readonly string[]
  readonly languageHint?: string
  readonly embeddingMode?: PdfFontEmbeddingMode
}

export interface BrowserPrintPdfJob {
  readonly documentId: string
  readonly title: string
  readonly html: string
  readonly fontStrategy: PdfFontStrategy
}

export type BrowserPrintPdfRenderer = (job: BrowserPrintPdfJob) => Uint8Array | Promise<Uint8Array>

export interface BrowserPrintPdfProviderOptions {
  readonly renderer: BrowserPrintPdfRenderer
  readonly fontStrategy?: PdfFontStrategy
  readonly validatePdfHeader?: boolean
}

export function createBrowserPrintPdfProvider(
  options: BrowserPrintPdfProviderOptions,
): PdfExportProvider {
  return async (input) => {
    const pdf = await options.renderer({
      documentId: input.documentId,
      title: input.title,
      html: input.html,
      fontStrategy: normalizeFontStrategy(options.fontStrategy),
    })

    if (options.validatePdfHeader ?? true) {
      assertPdfBytes(pdf)
    }

    return pdf
  }
}

function normalizeFontStrategy(strategy: PdfFontStrategy | undefined): PdfFontStrategy {
  return Object.freeze({
    fontFamilies: Object.freeze([...(strategy?.fontFamilies ?? [])]),
    fallbackFamilies: Object.freeze([
      ...(strategy?.fallbackFamilies ?? [
        'Noto Sans CJK SC',
        'Noto Sans CJK TC',
        'Noto Sans JP',
        'Noto Sans KR',
        'Microsoft YaHei',
        'PingFang SC',
        'Arial Unicode MS',
        'sans-serif',
      ]),
    ]),
    languageHint: strategy?.languageHint ?? 'und',
    embeddingMode: strategy?.embeddingMode ?? 'prefer-embed',
  })
}

function assertPdfBytes(pdf: Uint8Array): void {
  const header = new TextDecoder().decode(pdf.slice(0, 5))

  if (header !== '%PDF-') {
    throw new Error('Browser print PDF renderer did not return PDF bytes')
  }
}
