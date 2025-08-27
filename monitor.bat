@echo off
:: Monitor Badminton Bot Resource Usage - Windows Version
echo 🏸 Badminton Bot Resource Monitor
echo ==================================

:: Check if bot is running
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo ✅ Bot is running
    
    :: Get process information
    echo 📊 Node.js processes:
    wmic process where "name='node.exe'" get ProcessId,PageFileUsage,PercentProcessorTime /format:table
    
    echo.
    echo Chrome processes:
    tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL
    
) else (
    echo ❌ Bot is not running
    echo 💡 Start with: start.bat or npm start
)

echo.
echo 📈 System Memory:
wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /value

pause
