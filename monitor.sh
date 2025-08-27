#!/bin/bash

# Monitor Badminton Bot Resource Usage
echo "🏸 Badminton Bot Resource Monitor"
echo "=================================="

# Check if bot is running
if pgrep -f "node bot.js" > /dev/null; then
    echo "✅ Bot is running"
    
    # Get process ID
    PID=$(pgrep -f "node bot.js")
    
    # Memory usage in MB
    MEMORY_KB=$(ps -o rss= -p $PID)
    MEMORY_MB=$((MEMORY_KB / 1024))
    
    # CPU usage
    CPU=$(ps -o %cpu= -p $PID)
    
    echo "📊 Process ID: $PID"
    echo "💾 Memory Usage: ${MEMORY_MB}MB"
    echo "🔥 CPU Usage: ${CPU}%"
    
    # Show Chrome processes too
    echo ""
    echo "Chrome processes:"
    ps aux | grep -E "(chrome|chromium)" | grep -v grep | while read line; do
        echo "  $line"
    done
    
else
    echo "❌ Bot is not running"
    echo "💡 Start with: ./start.sh or npm start"
fi

echo ""
echo "📈 System Memory:"
if command -v free >/dev/null 2>&1; then
    free -h
elif command -v vm_stat >/dev/null 2>&1; then
    # macOS
    vm_stat | head -5
fi
