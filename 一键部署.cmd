@echo off
chcp 65001 >nul
title DeepSeek Harness Phone Remote - One-Click Deploy
echo ============================================
echo   DeepSeek Harness Phone Remote 一键部署
echo ============================================
echo.
echo 建议:如果读取 Tailscale IP 或配置 Serve 失败,
echo 请右键本文件选择"以管理员身份运行"。
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
