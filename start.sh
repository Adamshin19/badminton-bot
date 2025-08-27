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

# Check if .envrc file exists and direnv is configured
if [ ! -f .envrc ]; then
    echo "⚠️  .envrc file not found. Creating template..."
    cat > .envrc << EOF
export OPENAI_API_KEY=your_api_key_here
export GROUP_NAME="your_whatsapp_group_name"
export DEFAULT_LOCATION="Batts"
export PLAYERS_PER_COURT=4
export MAX_PLAYERS_PER_COURT=5
EOF
    echo "📝 Please edit .envrc file with your settings"
    echo "📝 Then run: direnv allow ."
    echo "📝 Finally, run this script again."
    exit 1
fi

# Check if direnv is installed
if ! command -v direnv >/dev/null 2>&1; then
    echo "❌ direnv not found. Please install direnv first:"
    echo "   brew install direnv"
    echo "   Then add to your shell config: eval \"\$(direnv hook zsh)\""
    exit 1
fi

# Check if OPENAI_API_KEY is loaded (indicates direnv is working)
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  Environment variables not loaded. Please run:"
    echo "   direnv allow ."
    echo "   Then run this script again."
    exit 1
fi

echo "✅ Environment variables loaded via direnv"

# Start the bot
echo "🚀 Starting bot..."
node bot.js
