@echo off
chcp 65001 >nul
cd /d "%~dp0"
netstat -an | findstr "127.0.0.1:8765" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo 服务已在运行，直接打开浏览器...
  start "" "http://127.0.0.1:8765/"
  timeout /t 2 >nul
  exit /b
)
echo.
echo   极光圣诞树 · 本地服务启动中
echo   地址：http://127.0.0.1:8765
echo   关闭这个黑窗口即停止服务
echo.
start "" "http://127.0.0.1:8765/"
python -m http.server 8765 --bind 127.0.0.1
pause
