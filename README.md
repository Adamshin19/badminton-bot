# Badminton Bot 🏸

An intelligent WhatsApp bot for managing badminton group coordination and player lists.

## Features

✅ **AI-Powered Message Analysis** - Uses OpenAI to understand natural language messages  
✅ **Automatic Player Management** - Tracks players and waitlists  
✅ **Guest Management** - Handle guest additions via other players  
✅ **Smart Court Allocation** - Dynamic court booking based on player count  
✅ **Location Tracking** - Supports multiple venues (Batts, Lions, etc.)  
✅ **Poll Vote Integration** - Responds to WhatsApp poll votes  
✅ **Waitlist Management** - Automatic promotion when spots open up  
✅ **Ultra-Low Memory Usage** - Optimized to run on minimal resources

## Quick Start (Cross-Platform)

### Prerequisites

- Node.js 18+
- Google Chrome browser
- OpenAI API key

### 1. Clone and Install

```bash
git clone https://github.com/Adamshin19/badminton-bot.git
cd badminton-bot
npm install
```

### 2. Configure Environment

**macOS/Linux:**

```bash
# Automatic setup with script
./start.sh

# Or manual setup
cat > .env << EOF
OPENAI_API_KEY=your_api_key_here
GROUP_NAME=your_whatsapp_group_name
DEFAULT_LOCATION=Batts
PLAYERS_PER_COURT=4
MAX_PLAYERS_PER_COURT=5
EOF
```

**Windows:**

```cmd
# Simple startup
start.bat
```

**Note**: Edit the `OPENAI_API_KEY` directly in `start.bat` on line 20.

### 3. Start the Bot

**macOS/Linux:**

```bash
# Optimized startup (recommended)
./start.sh

# Or standard startup
npm start
```

**Windows:**

```cmd
# Simple startup
start.bat
```

### 4. Monitor Resources (Optional)

**macOS/Linux:**

```bash
./monitor.sh
```

**Windows:**

```cmd
monitor.bat
```

### 4. Authenticate WhatsApp

- QR code will appear in the terminal
- Scan with your WhatsApp to authenticate
- Session will be saved for future runs

## Resource Usage ⚡

**Memory Usage**: ~50-100MB (vs 600-800MB with Docker)  
**CPU Usage**: Minimal when idle, moderate during message processing  
**Disk Usage**: ~200MB for dependencies + ~50MB for session data

### Why No Docker?

Docker adds 600-800MB overhead for a simple Node.js bot. This optimized setup:

- Uses **85% less memory** than Docker
- **Faster startup** (no container overhead)
- **Direct Chrome access** (no virtualization layer)
- **Simpler deployment** (just Node.js + Chrome)

### Performance Optimizations

✅ **Headless Chrome** - No GUI overhead  
✅ **Memory limits** - Node.js heap limited to 256MB  
✅ **Garbage collection** - Aggressive cleanup  
✅ **Disabled Chrome features** - Images, extensions, plugins disabled  
✅ **Single process** - Chrome runs in single-process mode

## Usage

The bot responds to natural language messages in your badminton group:

- **Join**: "I want to play", "Count me in"
- **Add guest**: "John wants to play", "+John"
- **Remove**: "I can't play anymore", "John doesn't want to play"
- **Check status**: "Who's playing?", "Any spots available?"
- **Location**: "Booked court at Lions", "Playing at Batts"

## Court Logic

- **1-5 players**: 1 court
- **6-7 players**: 1 court (extras go to waitlist until 8 players)
- **8-10 players**: 2 courts
- **11+ players**: Waitlist until enough for new court (groups of 4)

## Configuration

The bot automatically configures based on your `.env` file. Available settings:

- `GROUP_NAME`: WhatsApp group to monitor
- `DEFAULT_LOCATION`: Default playing location
- `OPENAI_API_KEY`: For AI message analysis (optional)
- `PLAYERS_PER_COURT`: Default players per court (4)
- `MAX_PLAYERS_PER_COURT`: Maximum before new court (5)

## Requirements

- **Node.js 18+** (Windows/macOS/Linux)
- **Google Chrome browser** (any platform)
- **WhatsApp account**
- **OpenAI API key** (optional - falls back to pattern matching)

### Platform-Specific Notes:

**Windows:**

- Use `start.bat` script for simple startup
- Edit the API key directly in the batch file (line 20)
- Chrome typically installed at: `C:\Program Files\Google\Chrome\Application\`

**macOS:**

- Use `start.sh` and direnv with `.envrc`
- Chrome typically installed at: `/Applications/Google Chrome.app/`

**Linux:**

- Use `start.sh` and direnv with `.envrc`
- Chrome typically installed at: `/usr/bin/google-chrome-stable`

## Version History

- **v1.0**: Initial release with basic functionality
- **v1.1**: Added AI analysis and improved court logic
- **v1.2**: Enhanced guest management and poll support
- **v1.3**: Removed Docker, optimized for minimal resource usage

## License

MIT License
