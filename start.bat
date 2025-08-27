@echo off
REM Badminton Bot - Simple Windows Startup Script

echo 🏸 Starting Badminton Bot...

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

REM Check for Chrome (required for WhatsApp Web)
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" goto chrome_found
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" goto chrome_found
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" goto chrome_found

echo ❌ Chrome not found. Please install Google Chrome from https://www.google.com/chrome/
pause
exit /b 1

:chrome_found
echo ✅ Chrome found

REM Set your OpenAI API key here (replace YOUR_API_KEY_HERE with your actual key)
set OPENAI_API_KEY=YOUR_API_KEY_HERE

REM Set ultra-low memory limit and power-saving Node.js options for minimum energy use
set NODE_OPTIONS=--max_old_space_size=128 --gc-interval=100 --optimize-for-size --use-idle-notification

echo 🚀 Starting bot with ultra-low power settings...
start /b /belownormal node bot.js

echo 📱 Bot is running in background with low priority for maximum energy efficiency
echo 💡 Press any key to exit this window (bot will continue running)
pause >nul
