import type { DocumentFileIdentity } from '../session/document-session'

export interface RecentFileEntry extends DocumentFileIdentity {
  readonly openedAt: number
}

export function recordRecentFile(
  recentFiles: readonly RecentFileEntry[],
  file: DocumentFileIdentity,
  openedAt: number,
  limit = 10,
): readonly RecentFileEntry[] {
  const normalizedLimit = Math.max(1, Math.floor(limit))
  const next: RecentFileEntry[] = [
    { ...file, openedAt },
    ...recentFiles.filter((entry) => entry.path !== file.path),
  ]

  return Object.freeze(next.slice(0, normalizedLimit))
}

export function removeRecentFile(
  recentFiles: readonly RecentFileEntry[],
  file: DocumentFileIdentity,
): readonly RecentFileEntry[] {
  return Object.freeze(recentFiles.filter((entry) => entry.path !== file.path))
}
