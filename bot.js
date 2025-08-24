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
      //   groupName: "Saturday Badminton Court Scavenging Carnivores",
      groupName: "Adam test",
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
    this.courtCount = 1; // Manually controlled court count
    this.targetGroup = null;
    this.lastStatusMessage = null; // Track the last status message to delete it
    this.conversationHistory = []; // Store last 5 messages for context analysis
    this.maxHistoryLength = 5; // Keep last 5 messages

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
          type: message.type, // Added to see message type
          hasMedia: message.hasMedia,
        });

        // Check if this is a poll message
        if (message.type === "poll_creation") {
          console.log(`📊 Poll created:`, {
            pollName: message.body,
            options: message.pollOptions || "No options found",
          });
          // Handle poll creation if it's from you
          if (
            message.fromMe &&
            message.body &&
            message.body.toLowerCase().includes("badminton")
          ) {
            console.log(
              `🏸 Badminton poll detected, treating as status inquiry`
            );
            await this.sendStatusUpdate(message);
            return;
          }
        }

        // Process messages in the target group (check both to and from for group messages)
        if (
          this.targetGroup &&
          (message.to === this.targetGroup.id._serialized ||
            message.from === this.targetGroup.id._serialized)
        ) {
          console.log(
            `✅ Processing message in target group from ${message.from} to ${message.to} (fromMe: ${message.fromMe})`
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
        } else {
          // Log and ignore all messages not sent to the target group
          if (message.body && message.body.trim() && message.type === "chat") {
            console.log(
              `🚫 Ignoring message not to target group: "${message.body}" (to: ${message.to}, from: ${message.from})`
            );
          }
          // Explicitly do nothing - don't process the message or call AI
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

      // Add message to conversation history
      this.addToConversationHistory(senderName, messageText);

      // Try conversation context analysis first
      const contextAnalysis = await this.analyzeConversationContext();
      if (contextAnalysis && contextAnalysis.action !== "irrelevant") {
        console.log(`🧠 Using conversation context analysis:`, contextAnalysis);
        if (contextAnalysis.contextExplanation) {
          console.log(`💭 Context: ${contextAnalysis.contextExplanation}`);
        }
        await this.handleAnalysisResult(contextAnalysis, senderName, message);
        return;
      }

      // Fallback to individual message analysis
      console.log(`🤖 Falling back to individual message analysis...`);
      const analysis = await this.analyzeMessageWithAI(messageText, senderName);
      console.log(`🤖 AI Analysis:`, analysis);

      if (!analysis || !analysis.action) {
        console.log(`⚠️  No valid analysis returned`);
        return;
      }

      await this.handleAnalysisResult(analysis, senderName, message);
    } catch (error) {
      console.error("❌ Error handling message:", error);
    }
  }

  addToConversationHistory(senderName, messageText) {
    const timestamp = new Date().toISOString();
    this.conversationHistory.push({
      sender: senderName,
      message: messageText,
      timestamp: timestamp,
    });

    // Keep only the last N messages
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(
        -this.maxHistoryLength
      );
    }

    console.log(
      `📝 Added to conversation history (${this.conversationHistory.length}/${this.maxHistoryLength}): ${senderName}: "${messageText}"`
    );
  }

  async analyzeConversationContext() {
    if (this.conversationHistory.length < 2) {
      console.log(
        `📚 Not enough conversation history (${this.conversationHistory.length} messages)`
      );
      return null;
    }

    try {
      // Format conversation history for AI
      const conversationText = this.conversationHistory
        .map((msg) => `${msg.sender}: ${msg.message}`)
        .join("\n");

      const prompt = `Analyze this WhatsApp conversation for badminton coordination. The bot manages a badminton playing list.

CONVERSATION:
${conversationText}

CRITICAL ANALYSIS RULES:
• Analyze ONLY the LAST message in the conversation - do not be influenced by previous messages
• Look for contradictory statements that cancel each other out
• "X wants to [action] BUT [negative condition]" = contradictory = irrelevant

STRICT BADMINTON-ONLY RULES:
• Only process badminton-related activities (default assumption for unspecified activities)
• Ignore tennis, squash, other sports, dining, social events
• If activity unclear, assume badminton unless explicitly stated otherwise

CONFIRMATION LEVELS:
• CONFIRMED: "yes", "count me in", "I'll come", definitive responses to playing
• BRINGING/ADDING: "so does X", "and X", "+X", "bringing X", "X wants to play" = definitive confirmations (always add these)  
• UNCERTAIN: "might", "maybe", "depends", "not sure", "let me check"
• CONTRADICTORY/NEGATIVE: "wants to but can't", "would like to but can't", "can't make it", "can't play" = irrelevant (do NOT add)
• Questions about others = ask_availability (do NOT add anyone, wait for their response)

CRITICAL RULE - QUESTIONS:
• "Can X play?", "Is X available?", "Does X want to play?" = ask_availability (NEVER add the person)
• Questions should NOT result in adding anyone to the list
• Wait for the questioned person to respond themselves

CRITICAL RULE - CONDITIONALS:
• "If X happens, then Y will play" = irrelevant (NEVER add anyone based on conditions)
• "If Davina is playing, abhi will play" = irrelevant (ignore conditional statements)
• "X will play if Y plays" = irrelevant (ignore conditional statements)
• Any statement with "if", "when", "assuming", "provided that" = irrelevant
• Only process definitive confirmations, not conditional ones

CONTRADICTION DETECTION:
• "X wants to join but he can't" = contradictory = irrelevant
• "X would like to play but can't make it" = contradictory = irrelevant  
• "X wants to come but has other plans" = contradictory = irrelevant
• If a statement contains BOTH positive intent AND negative outcome, mark as irrelevant

CONVERSATION FLOW PATTERNS:
1. Question-Answer Flow (different people): Person A asks → Person B responds "Yes" → add Person B as confirmed
2. Continuation Pattern (same person): Person A says "I want to play" → Person A says "so does mike" → add mike as confirmed  
3. Direct Addition: "bringing X", "X wants to play", "+X" → add X as confirmed
4. Uncertainty Responses: "might come", "maybe" → mark as irrelevant, don't add

NAME EXTRACTION:
• Extract clean first names only (no titles, nicknames in quotes)
• "my boyfriend", "my friend" without names = ask for clarification
• Handle multiple names in one message
• Preserve exact name spelling from conversation

ACTIONS (respond with appropriate action):
• add_guest: Someone confirmed to play (not the sender)
• remove_guest: Someone confirmed they can't come (not the sender)
• request_spot: Sender wants to play themselves  
• remove_player: Sender backing out themselves
• ask_availability: Asking if spots available ("anyone playing?", "room for more?")
• status_inquiry: Asking current status ("who's playing?", "what's the status?")
• location_update: Changing playing location - "playing at Lions", "we're at Batts", "location is Lions" (ONLY Adam Shin allowed)
• court_update: Changing court count (ONLY Adam Shin allowed)  
• irrelevant: Non-badminton or unclear messages

LOCATION DETECTION:
• "Lions" or "lions" = Lions Club
• "Batts" or "batts" = Batts Recreation Ground
• Phrases: "playing at [location]", "we're at [location]", "location is [location]", "[location] this week"

JSON FORMAT:
{
  "action": "action_type",
  "confidence": 0.8,
  "location": "Lions|Batts",
  "guestName": "single_name",
  "guestNames": ["name1", "name2"],
  "certainty": "confirmed|uncertain", 
  "contextExplanation": "brief explanation of reasoning"
}

EXAMPLES:
✅ "Do you want to play?" → "Yes" = add_guest
✅ "I want to play" → "so does mike" = add_guest (mike)
✅ "bringing sarah" = add_guest (sarah) 
✅ "Play today?" = ask_availability
✅ "Can't make it" = remove_player
✅ "We're playing at Lions this week" (Adam only) = location_update (Lions)
✅ "Location is Batts" (Adam only) = location_update (Batts)
❌ "If Davina is playing, abhi will play" = irrelevant (conditional - ignore)
❌ "John will play if Sarah plays" = irrelevant (conditional - ignore)
❌ "Phil wants to join but he can't" = irrelevant (contradictory - wants to BUT can't)
❌ "John would like to play but can't make it" = irrelevant (contradictory - would like BUT can't)
❌ "Sarah wants to come but has work" = irrelevant (contradictory - wants BUT has conflict)
❌ "Want to play tennis?" → "Yes" = irrelevant
❌ "might come" = irrelevant

FOCUS: If the latest message contains "wants/would like to [action] BUT [can't/conflict]", return irrelevant.

Return JSON only.`;

      console.log(`🧠 Using GPT-4o for conversation context analysis...`);
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o", // Upgraded model for better conversation context understanding
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0,
      });

      const content = response.choices[0].message.content.trim();
      console.log(`🧠 Raw conversation analysis: "${content}"`);

      // Clean up the response in case it has markdown or extra text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        console.log(`🧠 Conversation context analysis:`, analysis);
        return analysis;
      } else {
        throw new Error("No JSON found in conversation analysis");
      }
    } catch (error) {
      console.error("🧠 Conversation analysis failed:", error.message);
      return null;
    }
  }

  async handleAnalysisResult(analysis, senderName, message) {
    console.log(
      `🔍 handleAnalysisResult called with action: "${analysis.action}"`
    );

    if (analysis.action === "location_update" && senderName === "Adam Shin") {
      this.location = analysis.location;
      console.log(`📍 Location updated to: ${this.location}`);
      await this.sendStatusUpdate(message);
      return;
    }

    if (analysis.action === "add_guest") {
      // Check for uncertainty
      if (analysis.certainty === "uncertain") {
        console.log(
          `⚠️ Uncertain guest request for ${analysis.guestName}, not adding`
        );
        return;
      }

      // Determine who is responsible for the guest
      // For conversation context, use the responder as the host
      // For individual messages, use the senderName
      const guestHost = analysis.responder || senderName;

      console.log(
        `👥 Adding guest via conversation context - Host: ${guestHost}, Guest: ${
          analysis.guestName || analysis.guestNames
        }`
      );

      // Handle multiple guests
      if (analysis.guestNames && analysis.guestNames.length > 0) {
        console.log(`🔍 Processing guestNames array:`, analysis.guestNames);
        analysis.guestNames.forEach((guestName) => {
          console.log(`🔍 Adding guest from array: ${guestName}`);
          this.addPlayer(guestName, Date.now(), true, guestHost);
        });
      } else if (analysis.guestName) {
        console.log(`🔍 Adding single guest: ${analysis.guestName}`);
        this.addPlayer(analysis.guestName, Date.now(), true, guestHost);
      } else {
        console.log(`⚠️ No guest name found in analysis:`, analysis);
      }
      await this.sendStatusUpdate(message);
      return;
    }

    if (analysis.action === "court_update" && senderName === "Adam Shin") {
      // Only Adam can update court count - handle various patterns
      let newCourtCount = null;
      const messageText = message.body ? message.body.trim() : "";

      // Pattern 1: "booked 2 courts", "courts: 2", "2 courts"
      let courtMatch = messageText.match(
        /(?:booked?\s+|courts?:?\s*|have\s+)(\d+)/i
      );
      if (courtMatch) {
        newCourtCount = parseInt(courtMatch[1]);
      }

      // Pattern 2: "booked another court" (increment by 1)
      else if (messageText.match(/booked?\s+(another|one\s+more)\s+court/i)) {
        newCourtCount = this.courtCount + 1;
      }

      // Pattern 3: "cancelled a court", "lost a court" (decrement by 1)
      else if (
        messageText.match(/cancel(led)?\s+(a\s+)?court|lost\s+(a\s+)?court/i)
      ) {
        newCourtCount = Math.max(1, this.courtCount - 1); // Don't go below 1 court
      }

      // Pattern 4: "we have X courts now", "only X court(s)"
      else {
        courtMatch = messageText.match(
          /(?:we\s+have\s+|only\s+)(\d+)\s+courts?/i
        );
        if (courtMatch) {
          newCourtCount = parseInt(courtMatch[1]);
        }
      }

      if (newCourtCount && newCourtCount > 0) {
        console.log(
          `🏸 Detected court update: ${this.courtCount} → ${newCourtCount}`
        );
        this.updateCourtCount(newCourtCount);
        await this.sendStatusUpdate(message);
      } else {
        console.log(
          `⚠️ Court update detected but couldn't parse number from: "${messageText}"`
        );
      }
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

    if (analysis.action === "request_spot") {
      // For conversation context, the responder is the one wanting to play
      const playerName = analysis.responder || senderName;

      console.log(
        `🏸 Request spot via conversation context - Player: ${playerName}`
      );

      // Check if this is requesting a spot for someone else (guest)
      if (analysis.guestName && analysis.guestName !== playerName) {
        // This is a guest addition
        this.addPlayer(analysis.guestName, Date.now(), true, playerName);
      } else {
        // This is the player requesting a spot for themselves
        if (!this.isPlayerRegistered(playerName)) {
          this.addPlayer(playerName, Date.now(), false, null);
        }
      }
      await this.sendStatusUpdate(message);
      return;
    }

    if (analysis.action === "ask_availability") {
      // Questions about availability should NOT add anyone
      // Just wait for the person to respond themselves
      console.log(
        `❓ Question about availability for ${
          analysis.guestName || "someone"
        } - no action taken`
      );
      return;
    }

    // Only respond to badminton-related messages
    if (analysis.action !== "irrelevant" && analysis.confidence > 0.6) {
      // Handle any remaining actions that need responses
      if (analysis.action === "status_inquiry") {
        await this.sendStatusUpdate(message);
      }
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
      const prompt = `Analyze this WhatsApp message for badminton playing list management.

MESSAGE: "${messageText}"
SENDER: ${senderName}

CRITICAL ANALYSIS RULES:
• Look for contradictory statements that cancel each other out
• "X wants to [action] BUT [negative condition]" = contradictory = irrelevant
• If a statement contains BOTH positive intent AND negative outcome, mark as irrelevant
• CONDITIONAL STATEMENTS: "If X, then Y will play" = irrelevant (ignore all conditionals)
• Any statement with "if", "when", "assuming", "provided that" = irrelevant

STRICT BADMINTON-ONLY ANALYSIS:
• Only process badminton-related activities (default assumption for unspecified activities)
• Ignore tennis, squash, other sports, dining, social events
• If activity unclear, assume badminton unless explicitly stated otherwise

CONFIRMATION LEVELS:
• CONFIRMED: "yes", "count me in", "I'll come", definitive responses to playing
• BRINGING/ADDING: "so does X", "and X", "+X", "bringing X", "X wants to play" = definitive confirmations (always add these)
• UNCERTAIN: "might", "maybe", "depends", "not sure", "let me check"
• CONTRADICTORY/NEGATIVE: "wants to but can't", "would like to but can't", "can't make it", "can't play" = irrelevant (do NOT add)

CONTRADICTION DETECTION:
• "X wants to join but he can't" = contradictory = irrelevant
• "X would like to play but can't make it" = contradictory = irrelevant  
• "X wants to come but has other plans" = contradictory = irrelevant

STRICT RULES:
• NEVER add someone for questions: "Do you want to play?" = ask_availability (NOT add_guest)
• NEVER add someone for questions about others: "Can X play?" = ask_availability (NOT add_guest)
• NEVER add @tagged users unless they respond themselves or explicitly brought by someone
• NEVER add someone with contradictory statements: "X wants to but can't" = irrelevant
• "so does X", "bringing X", "+X", "X wants to play" = add_guest (confirmed)
• "I want to play", "count me in", "I'll play" = request_spot (sender wants to play)
• "I can't play", "backing out", "can't make it" = remove_player (sender can't play)
• "might come", "maybe playing" = irrelevant (too uncertain)
• Questions ending with "?": "Anyone playing?" = ask_availability, "Who's playing?" = status_inquiry, "Can X play?" = ask_availability
• Only Adam Shin can update location (Batts/Lions) or court count
• LOCATION DETECTION: "Lions"/"lions" = Lions Club, "Batts"/"batts" = Batts Recreation Ground
• LOCATION PHRASES: "playing at [location]", "we're at [location]", "[location] this week", "location is [location]"
• Extract multiple names into guestNames array

CRITICAL QUESTION RULE:
• Questions about specific people ("Can Andrew play?", "Is Sarah available?") = ask_availability
• Do NOT add the questioned person to the list - wait for them to respond

CRITICAL CONDITIONAL RULE:
• "If X happens, then Y will play" = irrelevant (NEVER add anyone based on conditions)
• "If Davina is playing, abhi will play" = irrelevant (ignore conditional statements)
• "X will play if Y plays" = irrelevant (ignore conditional statements)
• Any statement with "if", "when", "assuming", "provided that" = irrelevant

NAME EXTRACTION:
• Extract clean first names only (no titles, nicknames in quotes)
• "my boyfriend", "my friend" without names = ask for clarification
• Handle multiple names in one message
• Preserve exact name spelling from message

JSON RESPONSE FORMAT:
{
  "action": "add_guest|remove_guest|request_spot|remove_player|ask_availability|status_inquiry|location_update|court_update|irrelevant",
  "confidence": 0.8,
  "location": "Lions|Batts",
  "guestName": "single_name",
  "guestNames": ["name1", "name2"],
  "certainty": "confirmed|uncertain"
}

EXAMPLES:
✅ "so does nabeel" → add_guest(nabeel, confirmed)
✅ "bringing mike and sarah" → add_guest(guestNames: [mike, sarah])
✅ "+john" → add_guest(john, confirmed)
✅ "I want to play" → request_spot
✅ "count me in" → request_spot
✅ "I can't make it" → remove_player
✅ "Do you want to play?" → ask_availability (question about others)
✅ "Anyone playing?" → ask_availability
✅ "Who's playing?" → status_inquiry
✅ "Can Andrew play?" → ask_availability (question about specific person - do NOT add Andrew)
✅ "Is Sarah available?" → ask_availability (question about specific person - do NOT add Sarah)
✅ "booked 2 courts" (Adam only) → court_update
✅ "playing at Batts" (Adam only) → location_update (Batts)
✅ "We're at Lions this week" (Adam only) → location_update (Lions)
✅ "location is Lions" (Adam only) → location_update (Lions)
❌ "Do you want to play?" → NOT add_guest
❌ "Can Andrew play?" → NOT add_guest (wait for Andrew to respond)
❌ "If Davina is playing, abhi will play" → irrelevant (conditional - ignore)
❌ "John will play if Sarah plays" → irrelevant (conditional - ignore)
❌ "When we get to 8 people, mike will join" → irrelevant (conditional - ignore)
❌ "Phil wants to join but he can't" → irrelevant (contradictory - wants BUT can't)
❌ "John would like to play but can't make it" → irrelevant (contradictory - would like BUT can't)
❌ "Sarah wants to come but has work" → irrelevant (contradictory - wants BUT has conflict)
❌ "might come" → irrelevant
❌ "playing tennis" → irrelevant

FOCUS: Conditional statements and questions should NOT add anyone. Only definitive confirmations.

Return JSON only.`;

      console.log(`🤖 Using GPT-4o-mini for individual message analysis...`);
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
        return {
          action: "add_guest",
          guestName: extractedName,
          confidence: 0.8,
        };
      }
      return { action: "request_spot", confidence: 0.8 };
    }

    // Someone else can't play / doesn't want to play
    if (
      (text.includes("can't play") ||
        text.includes("cannot play") ||
        text.includes("doesn't want to play") ||
        text.includes("does not want to play")) &&
      extractedName
    ) {
      return {
        action: "remove_guest",
        guestName: extractedName,
        confidence: 0.8,
      };
    }

    // Sender backing out
    if (
      text.includes("i can't play") ||
      text.includes("i cannot play") ||
      text.includes("not playing") ||
      text.includes("dropping out") ||
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
    if (text.includes("can play") || text.includes("count me")) {
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

      // Check if we need to reduce courts and move players to waitlist
      this.adjustPlayersAfterRemoval();
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

  adjustPlayersAfterRemoval() {
    const maxAllowedPlayers = this.courtCount * this.config.maxPlayersPerCourt;

    // If we have more players than courts can handle, move excess to waitlist
    while (this.players.length > maxAllowedPlayers && this.players.length > 0) {
      const lastPlayer = this.players.pop();
      this.waitlist.unshift(lastPlayer); // Add to front of waitlist
      console.log(`↩️ Moved ${lastPlayer.name} back to waitlist`);
    }

    // Otherwise, promote from waitlist if there's space
    if (this.players.length < maxAllowedPlayers) {
      this.promoteFromWaitlist();
    }
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

    // Don't auto-promote or auto-adjust courts
  }

  isPlayerRegistered(name) {
    return (
      this.players.some((p) => p.name === name) ||
      this.waitlist.some((p) => p.name === name)
    );
  }

  getTotalSpots() {
    // Use manually set court count instead of auto-calculating
    return this.courtCount * this.config.maxPlayersPerCourt;
  }

  getCourtCount() {
    // Return manually set court count
    return this.courtCount;
  }

  getMinimumPlayersNeeded() {
    // Calculate how many more players needed to justify current courts
    const minPlayersForCourts = this.courtCount * this.config.playersPerCourt;
    const currentPlayers = this.players.length + this.waitlist.length;
    return Math.max(0, minPlayersForCourts - currentPlayers);
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
    // Delete the previous status message if it exists
    if (this.lastStatusMessage) {
      try {
        console.log(`🗑️ Deleting previous status message for everyone`);
        await this.lastStatusMessage.delete(true); // true = delete for everyone
        this.lastStatusMessage = null;
      } catch (deleteError) {
        console.log(
          `⚠️ Could not delete previous status message:`,
          deleteError.message
        );
        // Continue even if delete fails
      }
    }

    const totalPlayers = this.players.length;
    const totalSpots = this.getTotalSpots();
    const courtCount = this.getCourtCount();
    const availableSpots = totalSpots - totalPlayers;
    const minPlayersNeeded = this.getMinimumPlayersNeeded();
    const totalPeopleCommitted = totalPlayers + this.waitlist.length;

    let response = `*Current Status:*\n`;
    response += `📍 Location: ${this.location} (9-11 AM Saturday)\n`;
    response += `🏸 Courts: ${courtCount}\n`;
    response += `👥 Players: ${totalPlayers}/${totalSpots}\n`;

    if (minPlayersNeeded > 0) {
      response += `⚠️ Need ${minPlayersNeeded} more player(s) to justify ${courtCount} court(s)\n`;
    } else if (availableSpots > 0) {
      response += `✅ Available spots: ${availableSpots}\n`;
    } else if (this.waitlist.length > 0) {
      response += `❌ Courts full - ${this.waitlist.length} on waitlist\n`;
    } else {
      response += `✅ Courts full\n`;
    }

    response += `\n*Playing (${this.players.length}):*\n`;
    this.players.forEach((player, index) => {
      response += `${index + 1}. ${player.name}\n`;
    });

    if (this.waitlist.length > 0) {
      response += `\n*Waitlist (${this.waitlist.length}):*\n`;
      this.waitlist.forEach((player, index) => {
        response += `${index + 1}. ${player.name}\n`;
      });
    }

    // Human-like delay
    await this.delay(Math.random() * 2000 + 1000);

    // Send the new status message and store it for future deletion
    const sentMessage = await message.reply(response);
    this.lastStatusMessage = sentMessage;

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

    this.client.initialize();
  }

  // Manual control methods
  async resetGame() {
    this.players = [];
    this.waitlist = [];
    this.courtCount = 1; // Reset to 1 court
    this.lastStatusMessage = null; // Clear the last status message reference
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

  // Manual court management
  updateCourtCount(newCount) {
    const oldCount = this.courtCount;
    this.courtCount = newCount;
    console.log(`🏸 Court count updated from ${oldCount} to ${newCount}`);

    // Adjust players/waitlist based on new court count
    if (newCount > oldCount) {
      // More courts available, promote from waitlist
      this.promoteFromWaitlist();
    } else if (newCount < oldCount) {
      // Fewer courts, may need to move players to waitlist
      this.adjustPlayersAfterRemoval();
    }

    return this.showStatus();
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
