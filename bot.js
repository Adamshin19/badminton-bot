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
    this.courtCount = 1; // Manually controlled court count
    this.targetGroup = null;
    this.activePoll = null;
    this.pollMonitoringInterval = null;

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

        // Check for poll vote messages (these might be separate message types)
        if (message.type === "poll_vote" || message.type === "poll_response") {
          console.log(`🗳️ Poll vote message detected:`, {
            type: message.type,
            from: message.from,
            body: message.body,
            pollData: message._data,
          });

          // Try to process this as a poll vote
          if (message._data && message._data.pollVote) {
            console.log(
              `🗳️ Processing poll vote from message_create:`,
              message._data.pollVote
            );
            await this.processPollVoteFromMessage(message);
          }
          return;
        }

        // Check if this is a poll message
        if (message.type === "poll_creation") {
          console.log(`📊 Poll created:`, {
            pollName: message.body,
            options: message.pollOptions || "No options found",
          });
          // Handle poll creation if it's from you and contains badminton keywords
          if (
            message.fromMe &&
            message.body &&
            (message.body.toLowerCase().includes("badminton") ||
              message.body.toLowerCase().includes("batts") ||
              message.body.toLowerCase().includes("lions"))
          ) {
            console.log(`🏸 Badminton poll detected, sending status update`);
            await this.sendStatusUpdate(message);

            // Store poll for monitoring
            this.activePoll = {
              id: message.id._serialized,
              message: message,
              lastCheckTime: Date.now(),
            };

            // Start monitoring this poll for votes
            this.startPollMonitoring(message);
            return;
          }
        }

        // Check if this is an update to an existing poll message
        if (
          message.type === "poll_creation" &&
          this.activePoll &&
          message.id._serialized === this.activePoll.id
        ) {
          console.log(`📊 Poll update detected for active poll`);
          await this.checkForPollVotes(message);
          return;
        }

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

          // Add fallback pattern matching for Adam's court updates
          if (message.fromMe && message.body) {
            const fallbackCourtUpdate = this.checkFallbackCourtUpdate(
              message.body
            );
            if (fallbackCourtUpdate) {
              console.log(
                `🏸 Fallback court update detected: ${fallbackCourtUpdate.action} → ${fallbackCourtUpdate.newCount}`
              );
              this.updateCourtCount(fallbackCourtUpdate.newCount);
              await this.sendStatusUpdate(message);
              return;
            }
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
        console.log(`🗳️ Poll vote detected:`, {
          voter: vote.voter.id.user,
          selectedOptions: vote.selectedOptions,
          parentMessageFrom: vote.parentMessage
            ? vote.parentMessage.from
            : "No parent message",
        });

        // Handle votes from target group OR direct messages for testing
        if (
          (this.targetGroup &&
            vote.parentMessage &&
            vote.parentMessage.from === this.targetGroup.id._serialized) ||
          (vote.parentMessage && vote.parentMessage.from.endsWith("@lid")) // Direct message polls
        ) {
          console.log(
            `✅ Processing poll vote in target group or direct message`
          );
          await this.handlePollVote(vote);
        } else {
          console.log(`⚠️ Poll vote not from target group or direct message`);
        }
      } catch (error) {
        console.error("Error in poll vote handler:", error);
      }
    });

    // Add listener for poll creation
    this.client.on("poll", async (poll) => {
      try {
        console.log(`📊 Poll created via 'poll' event:`, {
          id: poll.id,
          body: poll.body,
          from: poll.from,
          options: poll.options,
        });
      } catch (error) {
        console.error("Error in poll creation handler:", error);
      }
    });

    // Add comprehensive event debugging to catch poll votes
    this.client.on("vote_update", async (vote) => {
      console.log(`🗳️ Vote update event:`, vote);
      await this.handlePollVote(vote);
    });

    // Try alternative event names for poll votes
    [
      "poll_response",
      "poll_answer",
      "message_poll_vote",
      "vote",
      "poll_vote_update",
      "poll_vote_response",
      "pollVote",
      "vote_received",
      "poll_changed",
      "poll_updated",
    ].forEach((eventName) => {
      this.client.on(eventName, async (data) => {
        console.log(`🗳️ Poll event '${eventName}':`, data);
        if (
          data &&
          typeof data === "object" &&
          (data.voter || data.selectedOptions || data.pollVote)
        ) {
          await this.handlePollVote(data);
        }
      });
    });

    // Monitor for any changes to messages that might indicate poll votes
    this.client.on("message_revoke_everyone", async (message) => {
      console.log(`🔄 Message revoked:`, {
        from: message.from,
        type: message.type,
        body: message.body,
      });
    });

    this.client.on("message_edit", async (message, newBody, prevBody) => {
      console.log(`✏️ Message edited:`, {
        from: message.from,
        type: message.type,
        newBody,
        prevBody,
      });

      // Check if this is a poll message being edited (might contain vote updates)
      if (message.type === "poll_creation") {
        console.log(`📊 Poll message edited - checking for vote changes`);
        await this.checkForPollVotes(message);
      }
    });

    // Try to catch message media events (sometimes poll votes are media)
    this.client.on("media_uploaded", async (message) => {
      console.log(`📎 Media uploaded:`, {
        from: message.from,
        type: message.type,
        hasMedia: message.hasMedia,
      });
    });

    // Monitor group events that might be related to polls
    this.client.on("group_update", async (update) => {
      console.log(`👥 Group update:`, update);
    });

    // Debug: Log all events to find poll vote events
    const originalEmit = this.client.emit;
    const self = this; // Store reference to this
    this.client.emit = function (event, ...args) {
      // Log ALL events to see what we're missing
      if (event) {
        // Only log non-spam events to reduce noise
        if (!event.includes("loading") && !event.includes("progress")) {
          console.log(`🔍 All events: ${event}`);
        }

        // Focus on poll/vote/message events with more detail
        if (
          event.includes("poll") ||
          event.includes("vote") ||
          event.includes("message") ||
          event.includes("update") ||
          event.includes("change") ||
          event.includes("response") ||
          event.includes("answer")
        ) {
          console.log(
            `🔍 Event detected: ${event}`,
            args.length > 0
              ? args[0] && args[0].type
                ? `(type: ${args[0].type})`
                : "data available"
              : "no data"
          );

          // Log detailed data for poll/vote events
          if (event.includes("poll") || event.includes("vote")) {
            console.log(`🔍 ${event} detailed data:`, args[0]);
          }

          // Special handling for message_ack events on poll messages
          if (
            event === "message_ack" &&
            args[0] &&
            args[0].type === "poll_creation"
          ) {
            console.log(
              `🔍 Poll message ACK detected - checking for vote changes`
            );
            // Schedule a poll vote check
            setTimeout(async () => {
              try {
                const pollMessage = args[0];
                console.log(
                  `🔍 Delayed poll vote check for:`,
                  pollMessage.body
                );
                await self.checkForPollVotes(pollMessage);
              } catch (error) {
                console.error("Error in delayed poll check:", error);
              }
            }, 1000); // Wait 1 second to allow vote data to propagate
          }

          // Check for any message updates that might contain poll vote data
          if (event.includes("message") && args[0] && args[0]._data) {
            const data = args[0]._data;
            if (
              data.pollVotesSnapshot ||
              data.pollOptions ||
              data.pollVotes ||
              data.pollVote
            ) {
              console.log(`🔍 Poll data detected in ${event}:`, {
                pollVotesSnapshot: data.pollVotesSnapshot,
                pollOptions: data.pollOptions,
                pollVotes: data.pollVotes,
                pollVote: data.pollVote,
              });
            }
          }

          // Check for vote-specific events
          if (event.includes("vote")) {
            console.log(
              `🗳️ Vote event data structure:`,
              JSON.stringify(args[0], null, 2)
            );

            // Try to process this vote
            if (
              args[0] &&
              (args[0].voter || args[0].selectedOptions || args[0].pollVote)
            ) {
              console.log(`🗳️ Attempting to process vote from ${event}...`);
              // Use setTimeout to handle async in non-async function
              setTimeout(async () => {
                try {
                  await self.handlePollVote(args[0]);
                } catch (voteError) {
                  console.error(
                    `Error processing vote from ${event}:`,
                    voteError
                  );
                }
              }, 0);
            }
          }
        }
      }
      return originalEmit.apply(this, arguments);
    };
  }

  // Fallback pattern matching for court updates when AI fails
  checkFallbackCourtUpdate(messageText) {
    if (!messageText) return null;

    const text = messageText.toLowerCase();
    let newCourtCount = null;

    // Pattern 1: "booked 2 courts", "courts: 2", "2 courts"
    let courtMatch = text.match(/(?:booked?\s+|courts?:?\s*|have\s+)(\d+)/i);
    if (courtMatch) {
      newCourtCount = parseInt(courtMatch[1]);
      return { action: "set_courts", newCount: newCourtCount };
    }

    // Pattern 2: "booked another court" (increment by 1)
    else if (text.match(/booked?\s+(another|one\s+more)\s+court/i)) {
      newCourtCount = this.courtCount + 1;
      return { action: "add_court", newCount: newCourtCount };
    }

    // Pattern 3: "cancelled a court", "lost a court" (decrement by 1)
    else if (text.match(/cancel(led)?\s+(a\s+)?court|lost\s+(a\s+)?court/i)) {
      newCourtCount = Math.max(1, this.courtCount - 1);
      return { action: "cancel_court", newCount: newCourtCount };
    }

    // Pattern 4: "we have X courts now", "only X court(s)"
    else {
      courtMatch = text.match(/(?:we\s+have\s+|only\s+)(\d+)\s+courts?/i);
      if (courtMatch) {
        newCourtCount = parseInt(courtMatch[1]);
        return { action: "set_courts", newCount: newCourtCount };
      }
    }

    return null;
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

  async processPollVoteFromMessage(message) {
    try {
      console.log(`🗳️ Processing poll vote from message...`);
      console.log(`🔍 Message data:`, JSON.stringify(message._data, null, 2));

      // Try to extract poll vote information
      const pollVoteData = message._data.pollVote || message._data;
      const voterId = message.from;
      const contact = await message.getContact();
      const voterName = contact.pushname || contact.name || contact.id.user;

      console.log(`👤 Voter: ${voterName} (${voterId})`);

      // If this is related to our active poll
      if (this.activePoll) {
        console.log(`🔍 Checking if vote is for active poll...`);

        // Try to determine if this is a "Yes" vote
        // This will depend on the actual structure of pollVoteData
        let isYesVote = false;

        if (
          pollVoteData.selectedOptions &&
          pollVoteData.selectedOptions.includes(0)
        ) {
          isYesVote = true;
        } else if (pollVoteData.optionLocalId === 0) {
          isYesVote = true;
        } else if (pollVoteData.vote === 0 || pollVoteData.choice === 0) {
          isYesVote = true;
        }

        console.log(`🔍 Is YES vote: ${isYesVote}`);

        if (isYesVote) {
          console.log(`✅ ${voterName} voted YES, adding to game`);

          if (!this.isPlayerRegistered(voterName)) {
            this.addPlayer(voterName, Date.now(), false, null);
            console.log(`✅ Added ${voterName} from poll vote`);

            // Send status update
            await this.sendStatusUpdate(this.activePoll.message);
          } else {
            console.log(`⚠️ ${voterName} already registered, not adding again`);
          }
        } else {
          console.log(`❌ ${voterName} voted NO, not adding to game`);
        }
      }
    } catch (error) {
      console.error("Error processing poll vote from message:", error);
    }
  }

  async handlePollVote(vote) {
    try {
      console.log(`🗳️ Processing poll vote...`);
      const contact = await vote.voter.getContact();
      const voterName = contact.pushname || contact.name || vote.voter.id.user;

      console.log(`👤 Voter: ${voterName}`);
      console.log(`📊 Selected options:`, vote.selectedOptions);

      // Get the poll message details
      const pollMessage = vote.parentMessage;
      console.log(`📋 Poll message body:`, pollMessage.body);

      // Use AI to determine if this is a positive vote
      const isPositiveVote = await this.analyzeVoteWithAI(
        pollMessage.body,
        vote.selectedOptions
      );

      console.log(`🤖 AI determined positive vote: ${isPositiveVote}`);

      if (isPositiveVote) {
        // Don't add the voter if they're already registered
        if (!this.isPlayerRegistered(voterName)) {
          this.addPlayer(voterName, Date.now(), false, null);
          console.log(`✅ Added ${voterName} from poll vote`);

          // Send status update
          await this.sendStatusUpdate(pollMessage);
        } else {
          console.log(`⚠️ ${voterName} already registered, not adding again`);
        }
      } else {
        console.log(`❌ Vote from ${voterName} was not considered positive`);
      }
    } catch (error) {
      console.error("Error handling poll vote:", error);
    }
  }

  // Alternative approach: Monitor poll for changes with more aggressive detection
  startPollMonitoring(pollMessage) {
    console.log(`🔍 Starting poll monitoring for poll: ${pollMessage.body}`);

    // Store the original poll state
    let lastVoteCount = 0;
    let processedVoters = new Set();
    let lastPollData = null;

    // Check every 3 seconds for poll changes (more frequent)
    this.pollMonitoringInterval = setInterval(async () => {
      try {
        console.log(`🔍 Checking poll for votes...`);

        // Try to get updated message using different methods
        const chat = await pollMessage.getChat();

        // Method 1: Fetch messages and find our poll
        const messages = await chat.fetchMessages({ limit: 50 });
        const updatedPoll = messages.find(
          (msg) => msg.id._serialized === pollMessage.id._serialized
        );

        if (updatedPoll) {
          console.log(`📊 Found updated poll message`);

          // Log the complete poll data structure for debugging
          if (updatedPoll._data) {
            console.log(`🔍 Poll _data keys:`, Object.keys(updatedPoll._data));

            // Check for any vote-related properties
            const voteProps = Object.keys(updatedPoll._data).filter(
              (key) =>
                key.toLowerCase().includes("vote") ||
                key.toLowerCase().includes("poll") ||
                key.toLowerCase().includes("response") ||
                key.toLowerCase().includes("answer")
            );
            console.log(`🔍 Vote-related properties:`, voteProps);

            voteProps.forEach((prop) => {
              console.log(`🔍 ${prop}:`, updatedPoll._data[prop]);
            });
          }

          await this.checkForPollVotes(updatedPoll);

          // Method 2: Check poll options for vote counts
          if (updatedPoll.pollOptions) {
            let totalVotes = 0;
            updatedPoll.pollOptions.forEach((option, index) => {
              const votes = option.votes || option.voteCount || 0;
              totalVotes += votes;
              if (votes > 0) {
                console.log(
                  `📊 Option ${index} "${option.name}": ${votes} votes`
                );
              }
            });

            if (totalVotes > lastVoteCount) {
              console.log(
                `🗳️ Vote count changed from ${lastVoteCount} to ${totalVotes}`
              );
              lastVoteCount = totalVotes;

              // If "Yes" option (index 0) has votes, we need to find who voted
              const yesVotes = updatedPoll.pollOptions[0]?.votes || 0;
              if (yesVotes > 0) {
                console.log(
                  `✅ ${yesVotes} people voted YES - trying to identify voters`
                );
                // This is tricky without voter IDs, so let's try other methods
              }
            }
          }

          // Method 3: Try to get poll data directly from the message
          if (updatedPoll._data && updatedPoll._data.pollVotesSnapshot) {
            const currentVotes =
              updatedPoll._data.pollVotesSnapshot.pollVotes || [];
            console.log(
              `🔍 pollVotesSnapshot has ${currentVotes.length} votes`
            );

            if (currentVotes.length > 0) {
              console.log(
                `🔍 Vote data:`,
                JSON.stringify(currentVotes, null, 2)
              );
            }

            if (currentVotes.length > lastVoteCount) {
              console.log(
                `🗳️ New votes detected! ${currentVotes.length} total votes`
              );
              lastVoteCount = currentVotes.length;

              // Process new votes
              for (const vote of currentVotes) {
                console.log(`🔍 Processing vote:`, vote);
                const voterId =
                  vote.sender || vote.voter || vote.senderJid || vote.from;
                if (voterId && !processedVoters.has(voterId)) {
                  console.log(`🗳️ Processing new vote from: ${voterId}`);
                  processedVoters.add(voterId);

                  // Extract the voter name and process the vote
                  try {
                    const contact = await this.client.getContactById(voterId);
                    const voterName =
                      contact.pushname || contact.name || voterId.split("@")[0];

                    // Check if it's a "Yes" vote (option 0)
                    const selectedOption = vote.selectedOptions
                      ? vote.selectedOptions[0]
                      : vote.selectedOption;

                    console.log(
                      `🔍 Voter: ${voterName}, Selected option: ${selectedOption}`
                    );

                    if (selectedOption === 0 || selectedOption === "0") {
                      console.log(`✅ ${voterName} voted YES, adding to game`);

                      if (!this.isPlayerRegistered(voterName)) {
                        this.addPlayer(voterName, Date.now(), false, null);
                        console.log(`✅ Added ${voterName} from poll vote`);

                        // Send status update
                        await this.sendStatusUpdate(pollMessage);
                      } else {
                        console.log(
                          `⚠️ ${voterName} already registered, not adding again`
                        );
                      }
                    } else {
                      console.log(
                        `❌ ${voterName} voted NO, not adding to game`
                      );
                    }
                  } catch (contactError) {
                    console.error(
                      `Error getting contact for ${voterId}:`,
                      contactError
                    );
                  }
                }
              }
            }
          }

          // Method 4: Check for changes in the raw message data
          const currentPollData = JSON.stringify(updatedPoll._data);
          if (lastPollData && currentPollData !== lastPollData) {
            console.log(`🔍 Poll data changed - something happened!`);
            // Compare the differences
            if (updatedPoll._data && lastPollData) {
              console.log(
                `🔍 Poll message updated, checking for differences...`
              );
            }
          }
          lastPollData = currentPollData;
        } else {
          console.log(`⚠️ Could not find updated poll message`);
        }
      } catch (error) {
        console.error("Error monitoring poll:", error);
      }
    }, 3000); // Check every 3 seconds

    // Stop monitoring after 2 hours
    setTimeout(() => {
      if (this.pollMonitoringInterval) {
        clearInterval(this.pollMonitoringInterval);
        this.pollMonitoringInterval = null;
        console.log(`⏰ Stopped monitoring poll after 2 hours`);
      }
    }, 2 * 60 * 60 * 1000);
  }

  async checkForPollVotes(pollMessage) {
    try {
      console.log(`🔍 Checking for poll votes in message...`);

      // Log all available properties to understand the structure
      console.log(`📊 Poll message properties:`, Object.keys(pollMessage));

      // Method 1: Check for poll data in different locations
      if (pollMessage._data && pollMessage._data.pollVotesSnapshot) {
        console.log(
          `📊 Found pollVotesSnapshot:`,
          pollMessage._data.pollVotesSnapshot
        );

        if (
          pollMessage._data.pollVotesSnapshot.pollVotes &&
          pollMessage._data.pollVotesSnapshot.pollVotes.length > 0
        ) {
          console.log(
            `🗳️ Found ${pollMessage._data.pollVotesSnapshot.pollVotes.length} votes!`
          );

          // Process each vote
          for (const vote of pollMessage._data.pollVotesSnapshot.pollVotes) {
            console.log(`🗳️ Processing vote:`, vote);

            // Extract voter information
            const voterId = vote.sender || vote.voter;
            const selectedOptions = vote.selectedOptions || [
              vote.selectedOption,
            ];

            if (voterId && selectedOptions) {
              console.log(
                `👤 Voter ID: ${voterId}, Selected: ${selectedOptions}`
              );

              // Create a mock vote object for our existing handler
              const mockVote = {
                voter: { id: { user: voterId } },
                selectedOptions: selectedOptions,
                parentMessage: pollMessage,
              };

              await this.handlePollVote(mockVote);
            }
          }
        } else {
          console.log(`📊 No votes found in pollVotesSnapshot`);
        }
      }

      // Method 2: Check the direct poll property
      if (pollMessage.poll) {
        console.log(`📊 Poll object found:`, pollMessage.poll);

        if (pollMessage.poll.options) {
          pollMessage.poll.options.forEach((option, index) => {
            console.log(
              `📊 Option ${index}: ${option.name} - Votes: ${option.votes || 0}`
            );

            if (option.votes && option.votes.length > 0) {
              option.votes.forEach((vote) => {
                console.log(`🗳️ Vote from: ${vote.sender}`);
                // Process this vote too
              });
            }
          });
        }
      }

      // Method 3: Check pollOptions with vote counts
      if (pollMessage.pollOptions) {
        console.log(`📊 PollOptions found:`, pollMessage.pollOptions);
        pollMessage.pollOptions.forEach((option, index) => {
          if (option.votes) {
            console.log(
              `📊 Option ${index} (${option.name}): ${option.votes} votes`
            );
          }
        });
      }

      // Method 4: Try to access poll votes through different WhatsApp Web.js methods
      try {
        // Try to get poll data using WhatsApp Web.js internal methods
        if (pollMessage.getVotesData) {
          console.log(`🔍 Trying getVotesData method...`);
          const votesData = await pollMessage.getVotesData();
          console.log(`📊 Votes data from getVotesData:`, votesData);
        }
      } catch (methodError) {
        console.log(
          `⚠️ getVotesData method not available:`,
          methodError.message
        );
      }

      // Method 5: Try to manually parse the message data for any vote information
      if (pollMessage._data) {
        console.log(`🔍 Searching for vote data in _data...`);
        const dataString = JSON.stringify(pollMessage._data);

        // Look for vote-related keywords in the data
        const voteKeywords = [
          "vote",
          "voter",
          "option",
          "selected",
          "choice",
          "answer",
        ];
        voteKeywords.forEach((keyword) => {
          if (dataString.toLowerCase().includes(keyword)) {
            console.log(`🔍 Found keyword "${keyword}" in poll data`);
          }
        });

        // Check for any arrays that might contain vote data
        Object.keys(pollMessage._data).forEach((key) => {
          const value = pollMessage._data[key];
          if (Array.isArray(value) && value.length > 0) {
            console.log(`🔍 Array property "${key}":`, value);
          }
        });
      }

      // Method 6: Log the complete poll message structure periodically for debugging
      if (Math.random() < 0.1) {
        // 10% chance to reduce spam
        console.log(
          `🔍 Complete poll message structure:`,
          JSON.stringify(pollMessage._data, null, 2)
        );
      }

      if (
        !pollMessage.poll &&
        !pollMessage._data?.pollVotesSnapshot &&
        !pollMessage.pollOptions
      ) {
        console.log(`⚠️ No poll data found in any expected location`);
      }
    } catch (error) {
      console.error("Error checking poll votes:", error);
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
        // Check for uncertainty
        if (analysis.certainty === "uncertain") {
          console.log(
            `⚠️ Uncertain guest request for ${analysis.guestName}, not adding`
          );
          return;
        }

        // Handle multiple guests
        if (analysis.guestNames && analysis.guestNames.length > 1) {
          analysis.guestNames.forEach((guestName) => {
            this.addPlayer(guestName, Date.now(), true, senderName);
          });
        } else if (analysis.guestName) {
          this.addPlayer(analysis.guestName, Date.now(), true, senderName);
        }
        await this.sendStatusUpdate(message);
        return;
      }

      if (analysis.action === "court_update" && senderName === "Adam Shin") {
        // Only Adam can update court count - handle various patterns
        let newCourtCount = null;

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
  "guestName": "name_of_person_mentioned",
  "guestNames": ["name1", "name2"],
  "certainty": "confirmed/uncertain"
}

Actions (use ONLY these):
- location_update: mentions Batts or Lions
- add_guest: adding someone (ONLY if they DEFINITELY want to play - "X wants to play", "bringing X", "+X")
- remove_guest: removing guest (X can't come, X doesn't want to play anymore)
- request_spot: sender wants to play themselves
- remove_player: sender can't play anymore, backing out
- ask_availability: asking about spots
- status_inquiry: asking who's playing/status
- court_update: sender updating court count - booking courts ("booked X courts", "I booked another court") OR cancelling courts ("cancelled a court", "lost a court", "only 1 court now") (only from Adam Shin)
- irrelevant: not about badminton coordination

CRITICAL RULES:
- Only add guests if they are CONFIRMED to play ("X wants to play", "bringing X", "+X")
- If message contains "might", "maybe", "possibly", "thinking", set certainty: "uncertain" and action: "irrelevant"
- For multiple guests, extract all names into "guestNames" array
- If message mentions someone else's name and they want to play, use "add_guest" with their name(s)
- If message mentions someone else's name and they can't/don't want to play, use "remove_guest" with their name
- Only use "remove_player" if the SENDER is backing out themselves
- Only allow "court_update" from Adam Shin
- Always set "guestName" to the first name mentioned, "guestNames" to all names mentioned

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
    const totalPlayers = this.players.length;
    const totalSpots = this.getTotalSpots();
    const courtCount = this.getCourtCount();
    const availableSpots = totalSpots - totalPlayers;
    const minPlayersNeeded = this.getMinimumPlayersNeeded();
    const totalPeopleCommitted = totalPlayers + this.waitlist.length;

    let response = `*Current Status:*\n`;
    response += `📍 Location: ${this.location}\n`;
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
      const prefix = player.isGuest
        ? `${player.name} (guest via ${player.addedBy})`
        : player.name;
      response += `${index + 1}. ${prefix}\n`;
    });

    if (this.waitlist.length > 0) {
      response += `\n*Waitlist (${this.waitlist.length}):*\n`;
      this.waitlist.forEach((player, index) => {
        const prefix = player.isGuest
          ? `${player.name} (guest via ${player.addedBy})`
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
    this.courtCount = 1; // Reset to 1 court
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
