#!/bin/bash

# Badminton Bot - Optimized Startup Script
# This script runs the bot with minimal memory usage

echo "🏸 Starting Badminton Bot with optimized settings..."

# Set Node.js memory limits for efficiency
export NODE_OPTIONS="--max_old_space_size=256"

# Ensure Chrome is available
if [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    echo "✅ Chrome found at /Applications/Google Chrome.app"
elif command -v google-chrome >/dev/null 2>&1; then
    echo "✅ Chrome found via command line"
elif command -v google-chrome-stable >/dev/null 2>&1; then
    echo "✅ Chrome stable found"
else
    echo "❌ Chrome not found. Please install Google Chrome first."
    echo "   Expected location: /Applications/Google Chrome.app"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating template..."
    cat > .env << EOF
OPENAI_API_KEY=your_api_key_here
GROUP_NAME=your_whatsapp_group_name
DEFAULT_LOCATION=Batts
PLAYERS_PER_COURT=4
MAX_PLAYERS_PER_COURT=5
EOF
    echo "📝 Please edit .env file with your settings, then run this script again."
    exit 1
fi

# Start the bot
echo "🚀 Starting bot..."
node bot.js
