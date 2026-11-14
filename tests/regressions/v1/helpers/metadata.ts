export interface V1RegressionMetadata {
  readonly area: 'history' | 'paste' | 'mode-switch' | 'file' | 'rendering' | 'ime'
  readonly lesson: string
  readonly risk: string
  readonly source?: string
}

export function v1Issue(metadata: V1RegressionMetadata): V1RegressionMetadata {
  return Object.freeze(metadata)
}
