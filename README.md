# Badminton Bot 🏸

An intelligent WhatsApp bot that automatically manages badminton group coordination and player lists using AI.

## Features

✅ **AI-Powered Message Understanding** - Uses OpenAI to interpret natural language messages  
✅ **Automatic Player Management** - Tracks players and waitlists automatically  
✅ **Guest Management** - Handle guest additions through other players  
✅ **Smart Court Allocation** - Dynamically assigns courts based on player count  
✅ **Location Support** - Supports multiple venues (Batts, Lions, etc.)  
✅ **Poll Integration** - Responds to WhatsApp poll votes  
✅ **Waitlist Management** - Automatically promotes players when spots open  
✅ **Ultra-Low Resource Usage** - Optimized for minimal memory and power consumption

## Quick Start

### Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Google Chrome** - [Download here](https://www.google.com/chrome/)
- **OpenAI API Key** - [Get one here](https://platform.openai.com/api-keys)

### Installation

```bash
git clone https://github.com/Adamshin19/badminton-bot.git
cd badminton-bot
npm install
```

### Setup & Run

**Windows:**

1. Edit `start.bat` - Replace `YOUR_API_KEY_HERE` with your OpenAI API key
2. Run: `start.bat`

**macOS/Linux:**

1. Install direnv: `brew install direnv`
2. Edit `.envrc` - Replace the API key with yours
3. Run: `direnv allow .`
4. Run: `./start.sh`

### First Time Setup

1. **QR Code** - Scan the QR code with WhatsApp to authenticate
2. **Group Selection** - Bot will automatically find and connect to "Adam test" group
3. **Ready!** - Bot is now monitoring messages and managing players

## Usage Examples

The bot understands natural language messages:

- **Join**: "I want to play", "Count me in", "I can play"
- **Add Guest**: "John wants to play", "+John Smith"
- **Remove**: "I can't play anymore", "John doesn't want to play"
- **Check Status**: "Who's playing?", "Any spots available?"
- **Location**: "Booked court at Lions", "Playing at Batts today"

## Court Logic

- **1-5 players**: 1 court
- **6-7 players**: 1 court (extras waitlisted until 8 players)
- **8-10 players**: 2 courts
- **11+ players**: Additional courts in groups of 4

## Resource Usage

**Optimized for minimal impact:**

- Memory: ~60-80MB (vs 600MB+ with Docker)
- CPU: 1-3% when idle
- Power: Ultra-low consumption mode on Windows

## Configuration

**Hard-coded settings** (edit `bot.js` if needed):

- Group Name: "Adam test"
- Default Location: "Batts"
- Players per Court: 4
- Max Players per Court: 5

**Environment variable:**

- `OPENAI_API_KEY` - Required for AI message analysis

## Requirements

- Node.js 18 or higher
- Google Chrome browser
- OpenAI API key
- WhatsApp account

## Platform Support

- ✅ **Windows** - Uses `start.bat` with embedded API key
- ✅ **macOS** - Uses `start.sh` with direnv environment
- ✅ **Linux** - Uses `start.sh` with direnv environment

## Troubleshooting

**Bot won't start:**

- Check Node.js version: `node --version` (should be 18+)
- Check Chrome installation
- Verify API key is set correctly

**QR code not appearing:**

- Close any existing Chrome instances
- Try running the start script again

**Group not found:**

- Bot looks for exact match "Adam test"
- Check group name in WhatsApp matches exactly

## License

MIT License
