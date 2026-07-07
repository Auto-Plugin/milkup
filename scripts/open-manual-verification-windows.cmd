@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
if "%~1"=="--" shift
set "ARGS="
:collect_args
if "%~1"=="" goto run_script
set "ARGS=%ARGS% "%~1""
shift
goto collect_args

:run_script
where pwsh.exe >nul 2>nul
if %errorlevel%==0 (
  pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%open-manual-verification-windows.ps1" %ARGS%
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%open-manual-verification-windows.ps1" %ARGS%
)
