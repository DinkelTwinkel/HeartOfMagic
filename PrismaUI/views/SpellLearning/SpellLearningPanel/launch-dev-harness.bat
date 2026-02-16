@echo off
:: Launch Dev Harness
:: Opens the dev harness in Chrome for browser-based UI testing.
:: The dev harness uses mock data — no game or build server needed.

echo ============================================
echo  Heart of Magic - Dev Harness Launcher
echo ============================================

echo Opening dev harness in Chrome...
start "" "%~dp0dev-harness.html"

echo.
echo Dev harness launched. Close this window when done.
pause
