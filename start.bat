@echo off
:: Badminton Bot - Windows Startup Script
:: This script runs the bot with minimal memory usage

echo 🏸 Starting Badminton Bot with optimized settings...

:: Set Node.js memory limits for efficiency
set NODE_OPTIONS=--max_old_space_size=256

:: Ensure Chrome is available
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo ✅ Chrome found at C:\Program Files\Google\Chrome\Application\
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo ✅ Chrome found at C:\Program Files ^(x86^)\Google\Chrome\Application\
) else (
    echo ❌ Chrome not found. Please install Google Chrome first.
    echo    Expected location: C:\Program Files\Google\Chrome\Application\chrome.exe
    pause
    exit /b 1
)

:: Check if .env file exists
if not exist .env (
    echo ⚠️  .env file not found. Creating template...
    (
        echo OPENAI_API_KEY=your_api_key_here
        echo GROUP_NAME=your_whatsapp_group_name
        echo DEFAULT_LOCATION=Batts
        echo PLAYERS_PER_COURT=4
        echo MAX_PLAYERS_PER_COURT=5
    ) > .env
    echo 📝 Please edit .env file with your settings, then run this script again.
    pause
    exit /b 1
)

:: Start the bot
echo 🚀 Starting bot...
node bot.js

pause
