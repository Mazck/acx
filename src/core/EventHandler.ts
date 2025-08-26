import { Event, MessageObject, DatabaseManager, MessageContext } from '../types/interfaces';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';
import type { UranusBot } from './UranusBot';

export class EventHandler {
  private bot: UranusBot;
  private events: Map<string, any> = new Map();
  private chatEvents: Set<string> = new Set();
  private replyHandlers: Map<string, any> = new Map();
  private reactionHandlers: Map<string, any> = new Map();

  constructor(bot: UranusBot) {
    this.bot = bot;
  }

  registerEvent(event: any): void {
    const { name } = event.config;
    this.events.set(name, event);

    if (event.onChat) {
      this.chatEvents.add(name);
    }

    Logger.debug('EVENT_HANDLER', `Registered event: ${name}`);
  }

  async handle(event: Event, message: MessageObject, database: DatabaseManager): Promise<void> {
    try {
      const { threadID, senderID, type } = event;

      // Enhanced validation
      if (!threadID) {
        Logger.warn('EVENT_HANDLER', 'Missing threadID in event', {
          type,
          senderID,
          logMessageType: event.logMessageType,
          eventKeys: Object.keys(event)
        });
        return;
      }

      // Get thread data with fallback creation
      const threadData = await this.ensureThreadData(threadID, event, database);
      if (!threadData) {
        Logger.error('EVENT_HANDLER', `Could not create/retrieve thread data for ${threadID}`);
        return;
      }

      // Get user data with fallback creation (optional for some events)
      const userData = await this.ensureUserData(senderID, event, database);

      // Calculate user role
      const role = this.calculateUserRole(senderID || '', threadData);

      // Get prefix
      const prefix = threadData.data?.prefix || this.bot.getConfig().prefix;

      const context: MessageContext = {
        api: this.bot.getAPI(),
        event,
        args: [],
        message,
        userData: userData || this.createDefaultUserData(senderID || '', event),
        threadData,
        prefix,
        role,
        commandName: ''
      };

      // Handle different event types
      await this.processEventByType(context);

      // Handle chat events
      await this.handleChatEvents(context);

    } catch (error) {
      Logger.error('EVENT_HANDLER', 'Error in handle method', {
        error: error.message,
        threadID: event.threadID,
        senderID: event.senderID,
        type: event.type
      });
    }
  }

  // Ensure thread data exists
  private async ensureThreadData(threadID: string, event: Event, database: DatabaseManager): Promise<any> {
    try {
      let threadData = await database.threads.get(threadID);

      if (!threadData) {
        Logger.info('THREAD_HANDLER', `Creating missing thread: ${threadID}`);

        // Try to get thread info from API
        let apiThreadInfo: any = {};
        try {
          if (this.bot.getAPI()?.getThreadInfo) {
            apiThreadInfo = await this.bot.getAPI().getThreadInfo(threadID);
          }
        } catch (apiError) {
          Logger.warn('THREAD_HANDLER', 'Could not fetch thread info from API', apiError);
        }

        // Create thread with available data
        threadData = await database.threads.create(threadID, {
          threadName: apiThreadInfo.threadName ||
            event.threadName ||
            `Thread ${threadID}`,
          isGroup: event.isGroup !== false,
          adminIDs: apiThreadInfo.adminIDs || [],
          members: apiThreadInfo.participantIDs?.map((id: string) => ({
            userID: id,
            name: `User${id}`,
            inGroup: true,
            count: 0
          })) || []
        });

        Logger.success('THREAD_HANDLER', `Created thread: ${threadData.threadName} (${threadID})`);
      }

      return threadData;
    } catch (error) {
      Logger.error('THREAD_HANDLER', `Failed to ensure thread data for ${threadID}`, error);
      return null;
    }
  }

  // Ensure user data exists (optional)
  private async ensureUserData(senderID: string | undefined, event: Event, database: DatabaseManager): Promise<any> {
    if (!senderID) {
      return null; // Some events don't have senderID
    }

    try {
      let userData = await database.users.get(senderID);

      if (!userData) {
        Logger.info('USER_HANDLER', `Creating missing user: ${senderID}`);

        // Try to get user info from API
        let apiUserInfo: any = {};
        try {
          if (this.bot.getAPI()?.getUserInfo) {
            const userInfoResponse = await this.bot.getAPI().getUserInfo(senderID);
            apiUserInfo = userInfoResponse[senderID] || {};
          }
        } catch (apiError) {
          Logger.warn('USER_HANDLER', 'Could not fetch user info from API', apiError);
        }

        // Create user with available data
        userData = await database.users.create(senderID, {
          name: apiUserInfo.name ||
            event.senderName ||
            `User${senderID}`
        });

        Logger.success('USER_HANDLER', `Created user: ${userData.name} (${senderID})`);
      }

      return userData;
    } catch (error) {
      Logger.error('USER_HANDLER', `Failed to ensure user data for ${senderID}`, error);
      return null;
    }
  }

  // Create default user data for events without senderID
  private createDefaultUserData(senderID: string, event: Event): any {
    return {
      userID: senderID,
      name: event.senderName || `User${senderID}` || 'Unknown User',
      exp: 0,
      money: 0,
      banned: {},
      settings: {},
      data: {}
    };
  }

  // Process events by type
  private async processEventByType(context: MessageContext): Promise<void> {
    const { event } = context;
    const { type } = event;

    try {
      switch (type) {
        case 'message':
        case 'message_reply':
          await this.handleMessage(context);
          break;

        case 'message_reaction':
          await this.handleReaction(context);
          break;

        case 'event':
          await this.handleGroupEvent(context);
          break;

        case 'log:subscribe':
        case 'log:unsubscribe':
          await this.handleMembershipEvent(context);
          break;

        default:
          Logger.debug('EVENT_HANDLER', `Unhandled event type: ${type}`, {
            threadID: event.threadID,
            senderID: event.senderID,
            logMessageType: event.logMessageType
          });
      }
    } catch (error) {
      Logger.error('EVENT_HANDLER', `Error processing event type ${type}`, error);
    }
  }

  // Handle membership events (join/leave)
  private async handleMembershipEvent(context: MessageContext): Promise<void> {
    const { event } = context;

    Logger.info('MEMBERSHIP', `Membership event in ${event.threadID}`, {
      type: event.logMessageType,
      data: event.logMessageData
    });

    // Trigger membership-related events
    for (const [, eventHandler] of this.events) {
      if (eventHandler.onEvent) {
        try {
          const result = await eventHandler.onEvent(context);
          if (typeof result === 'function') {
            await result();
          }
        } catch (error) {
          Logger.error('MEMBERSHIP_EVENT', `Error in membership event handler ${eventHandler.config.name}`, error);
        }
      }
    }
  }

  private async handleMessage(context: MessageContext): Promise<void> {
    const { event, prefix, message } = context;
    const { body } = event;

    if (!body || typeof body !== 'string') return;

    try {
      // Handle reply
      if (event.messageReply && this.replyHandlers.has(event.messageReply.messageID)) {
        await this.handleReplyEvent(context);
        return;
      }

      // Handle command
      if (body.startsWith(prefix)) {
        const args = body.slice(prefix.length).trim().split(/\s+/).filter(arg => arg.length > 0);
        context.args = args;

        if (args.length > 0) {
          Logger.debug('COMMAND', `Processing command: ${args[0]}`, {
            threadID: event.threadID,
            senderID: event.senderID,
            args: args.slice(1)
          });

          const executed = await this.bot.getCommandManager().executeCommand(context);

          if (!executed) {
            // Command not found - suggest similar commands
            const suggestions = this.findSimilarCommands(args[0]);
            if (suggestions.length > 0) {
              await message.reply(`❌ Command "${args[0]}" not found. Did you mean: ${suggestions.map(s => `\`${prefix}${s}\``).join(', ')}?`);
            } else {
              await message.reply(`❌ Command "${args[0]}" not found. Use \`${prefix}help\` to see all commands.`);
            }
          }
        }
      }
    } catch (error) {
      Logger.error('MESSAGE_HANDLER', 'Error handling message', {
        error: error.message,
        threadID: event.threadID,
        senderID: event.senderID
      });
    }
  }

  private async handleReaction(context: MessageContext): Promise<void> {
    const { event } = context;
    const { messageID } = event;

    if (!messageID) {
      Logger.warn('REACTION_HANDLER', 'Missing messageID for reaction');
      return;
    }

    if (this.reactionHandlers.has(messageID)) {
      const handler = this.reactionHandlers.get(messageID);
      try {
        await handler.command.onReaction({
          ...context,
          Reaction: handler.data
        });
      } catch (error) {
        Logger.error('REACTION_HANDLER', 'Error handling reaction', error);
      }
    }
  }

  private async handleGroupEvent(context: MessageContext): Promise<void> {
    const { event } = context;

    Logger.event(event.logMessageType || 'group_event', event.threadID, event.author || event.senderID);

    // Handle specific group events
    for (const [, eventHandler] of this.events) {
      if (eventHandler.onEvent) {
        try {
          const result = await eventHandler.onEvent(context);
          if (typeof result === 'function') {
            await result();
          }
        } catch (error) {
          Logger.error('GROUP_EVENT', `Error in event handler ${eventHandler.config.name}`, error);
        }
      }
    }
  }

  private async handleChatEvents(context: MessageContext): Promise<void> {
    for (const eventName of this.chatEvents) {
      const event = this.events.get(eventName);
      if (event && event.onChat) {
        try {
          const result = await event.onChat(context);
          if (typeof result === 'function') {
            await result();
          }
        } catch (error) {
          Logger.error('CHAT_EVENT', `Error in chat handler ${eventName}`, error);
        }
      }
    }
  }

  private async handleReplyEvent(context: MessageContext): Promise<void> {
    const { event } = context;

    if (!event.messageReply) return;

    const handler = this.replyHandlers.get(event.messageReply.messageID);

    if (!handler) return;

    try {
      await handler.command.onReply({
        ...context,
        Reply: handler.data,
        args: event.body ? event.body.trim().split(/\s+/) : []
      });
    } catch (error) {
      Logger.error('REPLY_HANDLER', 'Error handling reply', error);
    }
  }

  private calculateUserRole(senderID: string, threadData: any): number {
    const config = this.bot.getConfig();

    if (!senderID) return 0;

    // Bot admin (highest role)
    if (config.adminBot.includes(senderID)) return 2;

    // Group admin
    if (threadData.adminIDs && Array.isArray(threadData.adminIDs) && threadData.adminIDs.includes(senderID)) return 1;

    // Regular user
    return 0;
  }

  private findSimilarCommands(input: string, maxDistance: number = 3): string[] {
    const suggestions: string[] = [];
    const commandNames = this.bot.getCommandManager().getCommandNames();

    for (const name of commandNames) {
      const distance = Utils.levenshteinDistance(input.toLowerCase(), name.toLowerCase());
      if (distance <= maxDistance) {
        suggestions.push(name);
      }
    }

    return suggestions.slice(0, 3); // Return max 3 suggestions
  }

  setReplyHandler(messageID: string, command: any, data: any): void {
    if (!messageID) return;

    this.replyHandlers.set(messageID, { command, data });

    // Auto-cleanup after 5 minutes
    setTimeout(() => {
      this.replyHandlers.delete(messageID);
    }, 5 * 60 * 1000);

    Logger.debug('EVENT_HANDLER', `Set reply handler for message ${messageID}`);
  }

  setReactionHandler(messageID: string, command: any, data: any): void {
    if (!messageID) return;

    this.reactionHandlers.set(messageID, { command, data });

    // Auto-cleanup after 10 minutes
    setTimeout(() => {
      this.reactionHandlers.delete(messageID);
    }, 10 * 60 * 1000);

    Logger.debug('EVENT_HANDLER', `Set reaction handler for message ${messageID}`);
  }

  removeReplyHandler(messageID: string): boolean {
    if (!messageID) return false;
    return this.replyHandlers.delete(messageID);
  }

  removeReactionHandler(messageID: string): boolean {
    if (!messageID) return false;
    return this.reactionHandlers.delete(messageID);
  }

  getEventCount(): number {
    return this.events.size;
  }

  getChatEventCount(): number {
    return this.chatEvents.size;
  }

  getActiveHandlers(): {
    replyHandlers: number;
    reactionHandlers: number;
  } {
    return {
      replyHandlers: this.replyHandlers.size,
      reactionHandlers: this.reactionHandlers.size
    };
  }

  // Enhanced cleanup method
  cleanup(): void {
    Logger.info('EVENT_HANDLER', 'Cleaning up event handlers...');

    this.replyHandlers.clear();
    this.reactionHandlers.clear();
    this.events.clear();
    this.chatEvents.clear();

    Logger.info('EVENT_HANDLER', 'Event handler cleanup completed');
  }

  // Get registered events
  getRegisteredEvents(): string[] {
    return Array.from(this.events.keys());
  }

  // Get event by name
  getEvent(name: string): any {
    return this.events.get(name);
  }

  // Check if event exists
  hasEvent(name: string): boolean {
    return this.events.has(name);
  }

  // Get event handler statistics
  getStats(): {
    totalEvents: number;
    chatEvents: number;
    replyHandlers: number;
    reactionHandlers: number;
  } {
    return {
      totalEvents: this.events.size,
      chatEvents: this.chatEvents.size,
      replyHandlers: this.replyHandlers.size,
      reactionHandlers: this.reactionHandlers.size
    };
  }
}