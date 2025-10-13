export interface ExportPDFOptions {
  pageSize?: 'A4' | 'Letter' | { width: number, height: number }
  scale?: number
}
