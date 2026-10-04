@echo off
chcp 65001 >nul
title Moshi - giong rieng / personal voice
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" %*
echo.
pause
