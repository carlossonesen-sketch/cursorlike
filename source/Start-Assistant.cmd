@echo off
setlocal
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0Start-Assistant.ps1"
exit /b %ERRORLEVEL%
