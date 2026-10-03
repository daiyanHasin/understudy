@echo off
:: Understudy - console mode (shows the server log; for troubleshooting)
:: For everyday use, double-click Understudy.vbs or the desktop shortcut.
:: Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved.
cd /d "%~dp0"
title Understudy (console)

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js was not found. Install Node.js 18 or newer from https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules\exceljs\" (
    echo First run: installing dependencies...
    call npm install --no-audit --no-fund
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
)

echo Starting Understudy...
echo.
node web-gui.js
pause
