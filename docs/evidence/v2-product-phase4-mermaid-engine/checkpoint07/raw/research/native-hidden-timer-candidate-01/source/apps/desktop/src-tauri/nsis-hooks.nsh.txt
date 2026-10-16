!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Markdown Document\DefaultIcon" "" "$INSTDIR\file.ico"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Markdown Document\DefaultIcon"
!macroend
