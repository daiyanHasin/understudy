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

set "US_PS=powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\install-deps.ps1""
if not exist "node_modules\exceljs\" (
    echo First run: installing dependencies...
    %US_PS%
    if errorlevel 1 (
        echo [ERROR] Installing failed. See logs\install.log and the hints above.
        pause
        exit /b 1
    )
)

:: Company networks that inspect HTTPS (Netskope, Zscaler ...): trust what Windows trusts
if not exist "tools\certs\company-ca.pem" %US_PS% -CertsOnly >nul 2>&1
if exist "tools\certs\company-ca.pem" set "NODE_EXTRA_CA_CERTS=%~dp0tools\certs\company-ca.pem"

echo Starting Understudy...
echo.
node web-gui.js
pause
