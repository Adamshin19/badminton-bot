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

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Adamshin19/badminton-bot.git
cd badminton-bot
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
# Create .envrc file with your OpenAI API key
echo "export OPENAI_API_KEY=your_api_key_here" > .envrc
direnv allow
```

4. Start the bot:

```bash
npm start
```

5. Scan the QR code with WhatsApp to authenticate

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

Update `bot.js` to customize:

- Group name to monitor
- Default location
- Players per court settings

## Requirements

- Node.js 18+
- WhatsApp account
- OpenAI API key (optional - falls back to pattern matching)

## Version History

- **v1.0**: Initial release with basic functionality
- **v1.1**: Added AI analysis and improved court logic
- **v1.2**: Enhanced guest management and poll support

## License

MIT License
