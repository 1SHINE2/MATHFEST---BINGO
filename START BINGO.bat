@echo off
title MathFest AI Speed Bingo — Launcher
color 0A

set ROOT=%~dp0
set NODE=%ROOT%node-v20.11.1-win-x64\node.exe
set TSX=%ROOT%node_modules\tsx\dist\cli.mjs
set VITE=%ROOT%node_modules\vite\bin\vite.js

echo.
echo  =====================================================
echo   MathFest AI Speed Bingo — Starting Servers...
echo  =====================================================
echo.

:: Start Backend in a new window
echo  [1/2] Starting Backend on http://localhost:3001 ...
start "MathFest BACKEND" cmd /k "title MathFest BACKEND && cd /d "%ROOT%backend" && "%NODE%" "%TSX%" src/index.ts"

:: Wait 2 seconds for backend to initialize
timeout /t 2 /nobreak >nul

:: Start Frontend in a new window
echo  [2/2] Starting Frontend on http://localhost:5173 ...
start "MathFest FRONTEND" cmd /k "title MathFest FRONTEND && cd /d "%ROOT%frontend" && "%NODE%" "%VITE%""

:: Wait 3 seconds for Vite to spin up
timeout /t 3 /nobreak >nul

:: Open browser
echo.
echo  Opening browser...
start http://localhost:5173

echo.
echo  =====================================================
echo   Both servers are running!
echo.
echo   Frontend : http://localhost:5173
echo   Backend  : http://localhost:3001
echo.
echo   Close the BACKEND and FRONTEND windows to stop.
echo  =====================================================
echo.
pause
