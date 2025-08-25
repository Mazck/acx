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
  }

  async handle(event: Event, message: MessageObject, database: DatabaseManager): Promise<void> {
    const { threadID, senderID, type } = event;

    // Get user and thread data
    const userData = await database.users.get(senderID || '');
    const threadData = await database.threads.get(threadID);

    if (!userData || !threadData) {
      Logger.warn('EVENT', 'Missing user or thread data');
      return;
    }

    // Calculate user role
    const role = this.calculateUserRole(senderID, threadData);

    // Get prefix
    const prefix = threadData.data?.prefix || this.bot.getConfig().prefix;

    const context: MessageContext = {
      api: this.bot.getAPI(),
      event,
      args: [],
      message,
      userData,
      threadData,
      prefix,
      role,
      commandName: ''
    };

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
      default:
        Logger.debug('EVENT', `Unhandled event type: ${type}`);
    }

    // Handle chat events
    await this.handleChatEvents(context);
  }

  private async handleMessage(context: MessageContext): Promise<void> {
    const { event, prefix, message } = context;
    const { body } = event;

    if (!body) return;

    // Handle reply
    if (event.messageReply && this.replyHandlers.has(event.messageReply.messageID)) {
      await this.handleReplyEvent(context);
      return;
    }

    // Handle command
    if (body.startsWith(prefix)) {
      const args = body.slice(prefix.length).trim().split(/\s+/);
      context.args = args;
      
      const executed = await this.bot.getCommandManager().executeCommand(context);
      
      if (!executed && args[0]) {
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

  private async handleReaction(context: MessageContext): Promise<void> {
    const { event } = context;
    const { messageID } = event;

    if (messageID && this.reactionHandlers.has(messageID)) {
      const handler = this.reactionHandlers.get(messageID);
      try {
        await handler.command.onReaction({
          ...context,
          Reaction: handler.data
        });
      } catch (error) {
        Logger.error('REACTION', 'Error handling reaction', error);
      }
    }
  }

  private async handleGroupEvent(context: MessageContext): Promise<void> {
    const { event } = context;
    
    Logger.event(event.logMessageType || 'group_event', event.threadID, event.author);

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
    const handler = this.replyHandlers.get(event.messageReply.messageID);
    
    if (!handler) return;

    try {
      await handler.command.onReply({
        ...context,
        Reply: handler.data,
        args: event.body ? event.body.trim().split(/\s+/) : []
      });
    } catch (error) {
      Logger.error('REPLY', 'Error handling reply', error);
    }
  }

  private calculateUserRole(senderID: string, threadData: any): number {
    const config = this.bot.getConfig();
    
    if (!senderID) return 0;
    
    // Bot admin (highest role)
    if (config.adminBot.includes(senderID)) return 2;
    
    // Group admin
    if (threadData.adminIDs && threadData.adminIDs.includes(senderID)) return 1;
    
    // Regular user
    return 0;
  }

  private findSimilarCommands(input: string, maxDistance: number = 3): string[] {
    const suggestions: string[] = [];
    const commandNames = Array.from(this.commands.keys());

    for (const name of commandNames) {
      const distance = Utils.levenshteinDistance(input.toLowerCase(), name);
      if (distance <= maxDistance) {
        suggestions.push(name);
      }
    }

    return suggestions.slice(0, 3); // Return max 3 suggestions
  }

  setReplyHandler(messageID: string, command: Command, data: any): void {
    this.replyHandlers.set(messageID, { command, data });
    
    // Auto-cleanup after 5 minutes
    setTimeout(() => {
      this.replyHandlers.delete(messageID);
    }, 5 * 60 * 1000);
  }

  setReactionHandler(messageID: string, command: Command, data: any): void {
    this.reactionHandlers.set(messageID, { command, data });
    
    // Auto-cleanup after 10 minutes
    setTimeout(() => {
      this.reactionHandlers.delete(messageID);
    }, 10 * 60 * 1000);
  }

  removeReplyHandler(messageID: string): boolean {
    return this.replyHandlers.delete(messageID);
  }

  removeReactionHandler(messageID: string): boolean {
    return this.reactionHandlers.delete(messageID);
  }

  getCommandCount(): number {
    return this.commands.size;
  }

  getAliasCount(): number {
    return this.aliases.size;
  }

  listCommands(category?: string): Command[] {
    if (category) {
      return this.getAllByCategory(category);
    }
    return this.getAll();
  }

  searchCommands(query: string): Command[] {
    const results: Command[] = [];
    const lowerQuery = query.toLowerCase();

    for (const command of this.commands.values()) {
      if (
        command.config.name.toLowerCase().includes(lowerQuery) ||
        command.config.description.toLowerCase().includes(lowerQuery) ||
        command.config.category.toLowerCase().includes(lowerQuery) ||
        command.config.aliases?.some(alias => alias.toLowerCase().includes(lowerQuery))
      ) {
        results.push(command);
      }
    }

    return results;
  }
}