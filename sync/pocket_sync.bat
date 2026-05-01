@echo off
setlocal EnableDelayedExpansion
title PocketSync

echo ============================================================
echo  PocketSync -- Hey Pocket Nightly Export
echo  %date%  %time%
echo ============================================================
echo.

:: ── Move to the folder containing this .bat file ──────────────
cd /d "%~dp0"

:: ── Verify .env exists before doing anything ──────────────────
if not exist ".env" (
    echo ERROR: .env file not found in %~dp0
    echo.
    echo Fix: copy .env.example to .env and fill in your API keys.
    echo.
    pause
    exit /b 1
)

:: ── Activate virtual environment if one exists ─────────────────
if exist ".venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call ".venv\Scripts\activate.bat"
    echo.
)

:: ── Verify Python is on PATH ───────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python was not found on PATH.
    echo.
    echo Fix: install Python from https://python.org
    echo      and make sure "Add Python to PATH" is checked during install.
    echo.
    pause
    exit /b 1
)

:: ── Run PocketSync ─────────────────────────────────────────────
python pocket_sync.py
set SYNC_EXIT=%errorlevel%

echo.
echo ============================================================
if %SYNC_EXIT% equ 0 (
    echo  Finished successfully. Check _logs\ for the full run log.
) else (
    echo  Finished with errors ^(exit code %SYNC_EXIT%^).
    echo  Check _logs\ for details.
)
echo ============================================================

:: ── Pause only when double-clicked from Explorer ───────────────
:: When Task Scheduler runs this, cmd is invoked without the .bat
:: filename in %cmdcmdline%, so findstr fails and we skip the pause.
:: When double-clicked, Explorer puts the full .bat path in %cmdcmdline%.
echo %cmdcmdline% | findstr /i "%~nx0" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo Press any key to close this window...
    pause >nul
)

exit /b %SYNC_EXIT%
