const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const OpenAI = require("openai");

class BadmintonBot {
  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
        executablePath:
          process.platform === "darwin"
            ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            : undefined,
      },
    });

    // Configuration - Easy to modify
    this.config = {
      groupName: "Adam test", // Updated to match your group
      defaultLocation: "Batts",
      openaiApiKey: process.env.OPENAI_API_KEY,
      playersPerCourt: 4,
      maxPlayersPerCourt: 5,
    };

    // Initialize OpenAI with cheapest model
    this.openai = new OpenAI({
      apiKey: this.config.openaiApiKey,
    });

    // Game state
    this.players = [];
    this.waitlist = [];
    this.location = this.config.defaultLocation;
    this.targetGroup = null;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on("qr", (qr) => {
      console.log("Scan this QR code with WhatsApp:");
      qrcode.generate(qr, { small: true });
    });

    this.client.on("ready", async () => {
      console.log("WhatsApp bot is ready!");
      await this.findTargetGroup();
    });

    this.client.on("message_create", async (message) => {
      try {
        console.log(`📨 Message created event:`, {
          from: message.from,
          body: message.body,
          fromMe: message.fromMe,
        });

        // Process messages from target group OR direct messages for testing
        if (
          (this.targetGroup &&
            message.from === this.targetGroup.id._serialized) ||
          message.from.endsWith("@lid") // Direct messages for testing
        ) {
          console.log(
            `✅ Processing message from ${
              message.from.endsWith("@lid") ? "direct message" : "target group"
            } (fromMe: ${message.fromMe})`
          );

          // Skip bot's own status update messages to avoid loops
          if (
            message.fromMe &&
            message.body &&
            message.body.includes("*Current Status:*")
          ) {
            console.log(`🤖 Skipping bot's own status message`);
            return;
          }

          await this.handleMessage(message);
        }
      } catch (error) {
        console.error("Error in message_create handler:", error);
      }
    });

    this.client.on("message", async (message) => {
      try {
        // This event might not catch all messages, so we're using message_create instead
        console.log(`📨 Regular message event (might be redundant):`, {
          from: message.from,
          body: message.body,
          fromMe: message.fromMe,
        });
      } catch (error) {
        console.error("Error in message handler:", error);
      }
    });

    this.client.on("poll_vote", async (vote) => {
      try {
        console.log(`🗳️ Poll vote detected from voter: ${vote.voter.id.user}`);
        if (
          this.targetGroup &&
          vote.parentMessage &&
          vote.parentMessage.from === this.targetGroup.id._serialized
        ) {
          console.log(`✅ Processing poll vote in target group`);
          await this.handlePollVote(vote);
        } else {
          console.log(`⚠️ Poll vote not from target group`);
        }
      } catch (error) {
        console.error("Error in poll vote handler:", error);
      }
    });
  }

  async findTargetGroup() {
    const chats = await this.client.getChats();

    console.log(`🔍 Searching for group: "${this.config.groupName}"`);
    console.log(`📋 Available groups:`);
    chats
      .filter((chat) => chat.isGroup)
      .forEach((chat) =>
        console.log(`  - "${chat.name}" (ID: ${chat.id._serialized})`)
      );

    // First try exact match
    this.targetGroup = chats.find(
      (chat) => chat.isGroup && chat.name === this.config.groupName
    );

    // If not found, try partial match
    if (!this.targetGroup) {
      this.targetGroup = chats.find(
        (chat) => chat.isGroup && chat.name.toLowerCase().includes("badminton")
      );
    }

    // If still not found, try any match with "test" for debugging
    if (!this.targetGroup) {
      this.targetGroup = chats.find(
        (chat) => chat.isGroup && chat.name.toLowerCase().includes("test")
      );
    }

    if (this.targetGroup) {
      console.log(`✅ Found target group: "${this.targetGroup.name}"`);
      console.log(`🆔 Group ID: ${this.targetGroup.id._serialized}`);
    } else {
      console.log("❌ Could not find target group");
    }
  }

  async handlePollVote(vote) {
    try {
      const contact = await vote.voter.getContact();
      const voterName = contact.pushname || contact.name || vote.voter.id.user;

      // Use AI to determine if this is a positive vote
      const pollMessage = await vote.parentMessage.body;
      const isPositiveVote = await this.analyzeVoteWithAI(
        pollMessage,
        vote.selectedOptions
      );

      if (isPositiveVote) {
        this.addPlayer(voterName, Date.now(), false, null);
        console.log(`✅ Added ${voterName} from poll vote`);
      }
    } catch (error) {
      console.error("Error handling poll vote:", error);
    }
  }

  async handleMessage(message) {
    try {
      console.log(`🔄 Starting message handling...`);

      const contact = await message.getContact();
      const senderName = contact.pushname || contact.name || contact.id.user;
      const messageText = message.body ? message.body.trim() : "";

      console.log(`👤 Processing message from ${senderName}: "${messageText}"`);

      // Skip empty messages
      if (!messageText) {
        console.log(`⚠️  Empty message, skipping`);
        return;
      }

      // Use AI to analyze the message intent
      console.log(`🤖 Calling AI analysis...`);
      const analysis = await this.analyzeMessageWithAI(messageText, senderName);
      console.log(`🤖 AI Analysis:`, analysis);

      if (!analysis || !analysis.action) {
        console.log(`⚠️  No valid analysis returned`);
        return;
      }

      if (analysis.action === "location_update") {
        this.location = analysis.location;
        console.log(`📍 Location updated to: ${this.location}`);
        return;
      }

      if (analysis.action === "add_guest") {
        this.addPlayer(analysis.guestName, Date.now(), true, senderName);
        await this.sendStatusUpdate(message);
        return;
      }

      if (analysis.action === "remove_player") {
        // Check if removing someone else or themselves
        if (analysis.guestName && analysis.guestName !== senderName) {
          // Removing someone else (guest or other player)
          this.removePlayer(analysis.guestName);
        } else {
          // Removing themselves
          this.removePlayer(senderName);
        }
        await this.sendStatusUpdate(message);
        return;
      }

      if (analysis.action === "remove_guest") {
        this.removePlayer(analysis.guestName);
        await this.sendStatusUpdate(message);
        return;
      }

      if (
        analysis.action === "request_spot" ||
        analysis.action === "ask_availability"
      ) {
        // Check if this is requesting a spot for someone else (guest)
        if (analysis.guestName && analysis.guestName !== senderName) {
          // This is a guest addition
          this.addPlayer(analysis.guestName, Date.now(), true, senderName);
        } else {
          // This is the sender requesting a spot for themselves
          if (!this.isPlayerRegistered(senderName)) {
            this.addPlayer(senderName, Date.now(), false, null);
          }
        }
        await this.sendStatusUpdate(message);
        return;
      }

      // Only respond to badminton-related messages
      if (analysis.action !== "irrelevant" && analysis.confidence > 0.6) {
        // Handle any remaining actions that need responses
        if (analysis.action === "status_inquiry") {
          await this.sendStatusUpdate(message);
        }
      }
    } catch (error) {
      console.error("❌ Error handling message:", error);
    }
  }

  async analyzeVoteWithAI(pollMessage, selectedOptions) {
    try {
      const prompt = `Poll: "${pollMessage}" | Options: ${JSON.stringify(
        selectedOptions
      )} | Is this a YES vote for playing? Answer: true/false only.`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini", // Cheapest model
        messages: [{ role: "user", content: prompt }],
        max_tokens: 5,
        temperature: 0,
      });

      return response.choices[0].message.content.toLowerCase().includes("true");
    } catch (error) {
      console.error("AI analysis failed, using fallback:", error);
      return selectedOptions && selectedOptions.includes("0");
    }
  }

  async analyzeMessageWithAI(messageText, senderName) {
    try {
      const prompt = `Message: "${messageText}" | Sender: ${senderName}

Analyze ONLY badminton coordination intent. Return valid JSON only:
{
  "action": "one_of_these_only",
  "confidence": 0.9,
  "location": "Batts",
  "guestName": "name_of_person_mentioned"
}

Actions (use ONLY these):
- location_update: mentions Batts or Lions
- add_guest: adding someone (+Name, bringing X, "X wants to play")
- remove_guest: removing guest (X can't come, X doesn't want to play anymore)
- request_spot: sender wants to play themselves
- remove_player: sender can't play anymore, backing out
- ask_availability: asking about spots
- status_inquiry: asking who's playing/status
- irrelevant: not about badminton coordination

IMPORTANT: 
- If message mentions someone else's name and they want to play, use "add_guest" with their name
- If message mentions someone else's name and they can't/don't want to play, use "remove_guest" with their name  
- Only use "remove_player" if the SENDER is backing out themselves
- Always set "guestName" to the name mentioned in the message (not the sender)

Return only valid JSON, no explanations.`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
        temperature: 0,
      });

      const content = response.choices[0].message.content.trim();
      console.log(`🤖 Raw AI response: "${content}"`);

      // Clean up the response in case it has markdown or extra text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in AI response");
      }
    } catch (error) {
      console.error(
        "AI analysis failed, using fallback patterns:",
        error.message
      );
      return this.fallbackMessageAnalysis(messageText);
    }
  }

  fallbackMessageAnalysis(messageText) {
    const text = messageText.toLowerCase();

    // Location detection
    if (text.includes("batts")) {
      return { action: "location_update", location: "Batts", confidence: 0.9 };
    }
    if (text.includes("lions")) {
      return { action: "location_update", location: "Lions", confidence: 0.9 };
    }

    // Guest addition
    if (messageText.startsWith("+")) {
      const guestName = messageText.substring(1).trim();
      return { action: "add_guest", guestName, confidence: 0.9 };
    }

    // Extract names from message for guest operations
    const nameMatch = messageText.match(/\b([A-Z][a-z]+)\b/);
    const extractedName = nameMatch ? nameMatch[1] : null;

    // Someone else wants to play
    if (text.includes("wants to play") || text.includes("want to play")) {
      if (extractedName) {
        return { action: "add_guest", guestName: extractedName, confidence: 0.8 };
      }
      return { action: "request_spot", confidence: 0.8 };
    }

    // Someone else can't play / doesn't want to play
    if (
      (text.includes("can't play") || text.includes("cannot play") || 
       text.includes("doesn't want to play") || text.includes("does not want to play")) &&
      extractedName
    ) {
      return { action: "remove_guest", guestName: extractedName, confidence: 0.8 };
    }

    // Sender backing out
    if (
      text.includes("i can't play") || text.includes("i cannot play") || 
      text.includes("not playing") || text.includes("dropping out") || 
      text.includes("backing out")
    ) {
      return { action: "remove_player", confidence: 0.8 };
    }

    // Availability questions
    if (
      text.includes("spot") ||
      text.includes("room") ||
      text.includes("available")
    ) {
      return { action: "ask_availability", confidence: 0.7 };
    }

    // Play requests (sender)
    if (
      text.includes("can play") ||
      text.includes("count me")
    ) {
      return { action: "request_spot", confidence: 0.8 };
    }

    return { action: "irrelevant", confidence: 0.5 };
  }

  removePlayer(name) {
    // Remove from players list
    const playerIndex = this.players.findIndex((p) => p.name === name);
    if (playerIndex !== -1) {
      this.players.splice(playerIndex, 1);
      console.log(`❌ Removed ${name} from playing list`);

      // Promote someone from waitlist
      this.promoteFromWaitlist();
      return true;
    }

    // Remove from waitlist
    const waitlistIndex = this.waitlist.findIndex((p) => p.name === name);
    if (waitlistIndex !== -1) {
      this.waitlist.splice(waitlistIndex, 1);
      console.log(`❌ Removed ${name} from waitlist`);
      return true;
    }

    console.log(`⚠️  ${name} not found in lists`);
    return false;
  }

  addPlayer(name, timestamp, isGuest, addedBy) {
    if (this.isPlayerRegistered(name)) {
      return;
    }

    const player = { name, timestamp, isGuest, addedBy };
    const totalSpots = this.getTotalSpots();

    if (this.players.length < totalSpots) {
      this.players.push(player);
      this.players.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`✅ Added ${name} to playing list`);
    } else {
      this.waitlist.push(player);
      this.waitlist.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`⏳ Added ${name} to waitlist`);
    }

    this.promoteFromWaitlist();
  }

  isPlayerRegistered(name) {
    return (
      this.players.some((p) => p.name === name) ||
      this.waitlist.some((p) => p.name === name)
    );
  }

  getTotalSpots() {
    const totalPeople = this.players.length + this.waitlist.length;
    
    // Court logic: 4-5 people = 1 court, 6-7 people = 1 court (6th+ on waitlist until 8)
    // 8-10 people = 2 courts, 11th+ on waitlist until 12, then 3 courts, etc.
    
    if (totalPeople <= 5) {
      return 5; // 1 court, max 5 people
    }
    
    // Calculate how many full courts we can support (min 4 people per court)
    const fullCourts = Math.floor(totalPeople / 4);
    
    // Each court can have 4-5 people, so max spots = courts * 5
    // But we only add a new court when we have enough people (multiple of 4)
    const maxSpotsForCourts = fullCourts * 5;
    
    return Math.max(5, maxSpotsForCourts); // At least 1 court (5 spots)
  }

  getCourtCount() {
    const totalPeople = this.players.length + this.waitlist.length;
    
    // Court logic: need minimum 4 people to justify a court
    if (totalPeople <= 5) {
      return 1;
    }
    
    // Calculate courts based on groups of 4 (minimum per court)
    return Math.floor(totalPeople / 4);
  }

  promoteFromWaitlist() {
    const totalSpots = this.getTotalSpots();
    while (this.players.length < totalSpots && this.waitlist.length > 0) {
      const promoted = this.waitlist.shift();
      this.players.push(promoted);
      this.players.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`🎉 Promoted ${promoted.name} from waitlist to playing`);
    }
  }

  async sendStatusUpdate(message) {
    const totalPlayers = this.players.length;
    const totalSpots = this.getTotalSpots();
    const courtCount = this.getCourtCount();
    const availableSpots = totalSpots - totalPlayers;

    let response = `*Current Status:*\n`;
    response += `📍 Location: ${this.location}\n`;
    response += `🏸 Courts: ${courtCount}\n`;
    response += `👥 Players: ${totalPlayers}/${totalSpots}\n`;

    if (availableSpots > 0) {
      response += `✅ Available spots: ${availableSpots}\n`;
    } else {
      response += `❌ Courts full\n`;
    }

    response += `\n*Playing (${this.players.length}):*\n`;
    this.players.forEach((player, index) => {
      const prefix = player.isGuest
        ? `+${player.name} (guest via ${player.addedBy})`
        : player.name;
      response += `${index + 1}. ${prefix}\n`;
    });

    if (this.waitlist.length > 0) {
      response += `\n*Waitlist (${this.waitlist.length}):*\n`;
      this.waitlist.forEach((player, index) => {
        const prefix = player.isGuest
          ? `+${player.name} (guest via ${player.addedBy})`
          : player.name;
        response += `${index + 1}. ${prefix}\n`;
      });
    }

    // Human-like delay
    await this.delay(Math.random() * 2000 + 1000);
    await message.reply(response);
    console.log(`📤 Sent status update`);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  start() {
    if (!this.config.openaiApiKey) {
      console.log(
        "⚠️  Warning: No OpenAI API key found. Bot will use basic pattern matching."
      );
      console.log(
        "   Set OPENAI_API_KEY environment variable for AI-powered message analysis."
      );
    }

    console.log("🚀 Starting WhatsApp Badminton Bot...");
    console.log(`📋 Monitoring group: ${this.config.groupName}`);
    console.log(`📍 Default location: ${this.config.defaultLocation}`);

    // Add a simple test
    setTimeout(() => {
      this.runTestAnalysis();
    }, 5000);

    this.client.initialize();
  }

  // Test function to verify AI is working
  async runTestAnalysis() {
    console.log("\n🧪 Running test analysis...");
    try {
      const testMessage = "I want to play";
      const analysis = await this.analyzeMessageWithAI(testMessage, "TestUser");
      console.log(`🧪 Test result for "${testMessage}":`, analysis);
    } catch (error) {
      console.log(`🧪 Test failed:`, error.message);
    }
    console.log("🧪 Test complete\n");
  }

  // Manual control methods
  async resetGame() {
    this.players = [];
    this.waitlist = [];
    console.log("🔄 Game state reset");
  }

  showStatus() {
    console.log("\n=== Current Game Status ===");
    console.log(`📍 Location: ${this.location}`);
    console.log(`🏸 Courts: ${this.getCourtCount()}`);
    console.log(
      `👥 Players (${this.players.length}):`,
      this.players.map((p) => p.name)
    );
    console.log(
      `⏳ Waitlist (${this.waitlist.length}):`,
      this.waitlist.map((p) => p.name)
    );
    console.log("========================\n");
  }

  updateGroupName(newGroupName) {
    this.config.groupName = newGroupName;
    console.log(`📋 Updated target group to: ${newGroupName}`);
    this.findTargetGroup();
  }
}

// Initialize and start the bot
const bot = new BadmintonBot();
bot.start();

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down bot...");
  await bot.client.destroy();
  process.exit();
});

module.exports = BadmintonBot;
