import { renderMarkdownDocumentHtml, type ExportUrlResolver } from './markdown-html'

export type ExportFormat = 'markdown' | 'html' | 'pdf'

export interface ExportDocument {
  readonly documentId: string
  readonly text: string
  readonly title?: string
}

export interface PdfExportInput {
  readonly documentId: string
  readonly title: string
  readonly source: string
  readonly html: string
  readonly themeStyles?: string
}

export type PdfExportProvider = (input: PdfExportInput) => Uint8Array | Promise<Uint8Array>

export interface ExportRequest {
  readonly documentId: string
  readonly format: ExportFormat
  readonly resolveUrl?: ExportUrlResolver
  readonly themeStyles?: string
  readonly pdfProvider?: PdfExportProvider
}

export interface ExportResult {
  readonly documentId: string
  readonly format: ExportFormat
  readonly content: string | Uint8Array
}

export function resolveExportDocument(
  documents: readonly ExportDocument[],
  request: ExportRequest,
): ExportDocument {
  const document = documents.find((candidate) => candidate.documentId === request.documentId)

  if (!document) {
    throw new Error(`Export document ${request.documentId} was not found`)
  }

  return document
}

export function exportDocument(
  documents: readonly ExportDocument[],
  request: ExportRequest,
): ExportResult {
  const document = resolveExportDocument(documents, request)
  const content =
    request.format === 'markdown'
      ? document.text
      : request.format === 'html'
        ? renderHtml(document, request)
        : exportPdfSync(document, request)

  return Object.freeze({
    documentId: document.documentId,
    format: request.format,
    content,
  })
}

export async function exportDocumentAsync(
  documents: readonly ExportDocument[],
  request: ExportRequest,
): Promise<ExportResult> {
  const document = resolveExportDocument(documents, request)

  if (request.format !== 'pdf') {
    return exportDocument(documents, request)
  }

  const content = await exportPdf(document, request)

  return Object.freeze({
    documentId: document.documentId,
    format: request.format,
    content,
  })
}

function renderHtml(document: ExportDocument, request: ExportRequest): string {
  return renderMarkdownDocumentHtml(document.text, {
    title: document.title ?? document.documentId,
    ...(request.resolveUrl ? { resolveUrl: request.resolveUrl } : {}),
    ...(request.themeStyles ? { themeStyles: request.themeStyles } : {}),
  })
}

function exportPdfSync(document: ExportDocument, request: ExportRequest): Uint8Array {
  const provider = requirePdfProvider(request)
  const result = provider(createPdfExportInput(document, request))

  if (isPromiseLike(result)) {
    throw new Error('PDF export provider returned a Promise; use exportDocumentAsync instead')
  }

  return result
}

async function exportPdf(document: ExportDocument, request: ExportRequest): Promise<Uint8Array> {
  const provider = requirePdfProvider(request)
  return provider(createPdfExportInput(document, request))
}

function createPdfExportInput(document: ExportDocument, request: ExportRequest): PdfExportInput {
  const title = document.title ?? document.documentId
  const html = renderHtml(document, request)

  return {
    documentId: document.documentId,
    title,
    source: document.text,
    html,
    ...(request.themeStyles ? { themeStyles: request.themeStyles } : {}),
  }
}

function requirePdfProvider(request: ExportRequest): PdfExportProvider {
  if (!request.pdfProvider) {
    throw new Error('PDF export requires a pdfProvider')
  }

  return request.pdfProvider
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}
