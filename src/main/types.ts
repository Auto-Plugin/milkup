export interface ExportPDFOptions {
  pageSize?: 'A4' | 'Letter' | { width: number, height: number }
  scale?: number
}
export type Block
  = | { type: 'heading', level: 1 | 2 | 3, text: string }
    | { type: 'paragraph', text: string }
    | { type: 'list', items: string[], ordered: boolean }
    | { type: 'code', lines: string[] }
