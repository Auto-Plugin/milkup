import { getSaveSafety, type DocumentSession, type SaveSafety } from '@milkup/tauri-bridge'

/**
 * Opening a rescue chooser does not overwrite the conflicted source. Keep the
 * original session/hash when writing: native Save As still checks that snapshot
 * if the selected destination is the source path (including canonical aliases).
 * This gate permits choosing a different file; it does not authorize a write.
 */
export function getSaveAsDialogSafety(session: DocumentSession): SaveSafety {
  const safety = getSaveSafety(session)
  return !safety.canSave && safety.reason === 'external-change' ? { canSave: true } : safety
}
