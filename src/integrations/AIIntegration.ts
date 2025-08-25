import { GoogleGenerativeAI } from '@google/generative-ai';
import { MessageContext, Command } from '../types/interfaces';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';

export interface AIConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export class AIIntegration {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: config.model });
  }

  async processMessage(context: MessageContext): Promise<string | null> {
    const { event, userData, threadData } = context;
    
    // Check if AI should respond (mentions, direct messages, or specific triggers)
    if (!this.shouldRespond(event, threadData)) {
      return null;
    }

    try {
      const prompt = this.buildPrompt(context);
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      
      return response.text();
    } catch (error) {
      Logger.error('AI', 'Failed to generate AI response', error);
      return 'Sorry, I encountered an error while processing your request.';
    }
  }

  private shouldRespond(event: any, threadData: any): boolean {
    const { body, mentions } = event;
    
    if (!body) return false;

    // Check if bot is mentioned
    const botID = (global as any).bot.getBotID();
    if (mentions && mentions.some((mention: any) => mention.id === botID)) {
      return true;
    }

    // Check if it's a DM
    if (!event.isGroup) {
      return true;
    }

    // Check AI triggers in group settings
    const aiTriggers = threadData.data?.aiTriggers || ['ai', 'uranus'];
    const lowerBody = body.toLowerCase();
    
    return aiTriggers.some((trigger: string) => lowerBody.includes(trigger.toLowerCase()));
  }

  private buildPrompt(context: MessageContext): string {
    const { event, userData, threadData } = context;
    const availableCommands = this.getAvailableCommands(context);
    
    const systemPrompt = `
You are Uranus Bot, a helpful and friendly AI assistant for Facebook Messenger groups.

Current Context:
- User: ${userData.name} (ID: ${userData.userID})
- Group: ${threadData.threadName} (${threadData.isGroup ? 'Group Chat' : 'Private Chat'})
- User Level: ${this.calculateLevel(userData.exp || 0)}
- User Balance: ${Utils.formatNumber(userData.money || 0)} coins

Available Commands:
${availableCommands.map(cmd => `- !${cmd.config.name}: ${cmd.config.description}`).join('\n')}

Guidelines:
1. Be helpful, friendly, and concise
2. You can suggest relevant commands when appropriate
3. Keep responses under 2000 characters
4. Use emojis to make responses more engaging
5. If asked about commands, refer to the available commands list
6. You can execute commands by responding with the exact command syntax

User Message: "${event.body}"

Respond naturally and helpfully. If the user is asking for something a command can do, suggest the appropriate command.
    `;

    return systemPrompt;
  }

  private getAvailableCommands(context: MessageContext): Command[] {
    const commandManager = (global as any).bot.getCommandManager();
    const allCommands = commandManager.getAll();
    
    // Filter commands based on user role
    return allCommands.filter(cmd => cmd.config.role <= context.role);
  }

  private calculateLevel(exp: number): number {
    return Math.floor(Math.sqrt(exp / 100));
  }

  async executeCommandIfNeeded(response: string, context: MessageContext): Promise<string> {
    const { prefix } = context;
    
    // Check if AI response contains a command
    const commandMatch = response.match(new RegExp(`\\${prefix}(\\w+)(?:\\s+(.*))?`));
    
    if (commandMatch) {
      const [fullMatch, commandName, commandArgs] = commandMatch;
      const commandManager = (global as any).bot.getCommandManager();
      const command = commandManager.get(commandName);
      
      if (command) {
        try {
          // Create new context for command execution
          const commandContext = {
            ...context,
            args: commandArgs ? commandArgs.split(/\s+/) : [],
            commandName: command.config.name
          };

          // Execute the command
          await command.onStart(commandContext);
          
          // Remove the command from the response
          return response.replace(fullMatch, `✅ Executed: ${fullMatch}`);
        } catch (error) {
          Logger.error('AI_COMMAND', `Failed to execute command ${commandName}`, error);
          return response.replace(fullMatch, `❌ Failed to execute: ${fullMatch}`);
        }
      }
    }
    
    return response;
  }

  static async create(apiKey: string): Promise<AIIntegration> {
    const config: AIConfig = {
      apiKey,
      model: 'gemini-pro',
      maxTokens: 1000,
      temperature: 0.7
    };

    return new AIIntegration(config);
  }
}

// AI Command for direct interaction
const aiCommand: Command = {
  config: {
    name: 'ai',
    aliases: ['ask', 'chat', 'gpt'],
    description: 'Chat with Uranus AI assistant',
    usage: 'ai <your message>',
    category: 'ai',
    role: 0,
    cooldown: 5,
    version: '1.0.0',
    author: 'Uranus Bot Team'
  },

  onStart: async (context: MessageContext) => {
    const { args, message, event } = context;
    
    if (args.length === 0) {
      return await message.reply(
        '🤖 **Uranus AI Assistant**\n\n' +
        '💡 Ask me anything! I can help with:\n' +
        '• General questions and advice\n' +
        '• Creative writing and ideas\n' +
        '• Problem solving\n' +
        '• Command suggestions\n\n' +
        `📝 Usage: \`${context.prefix}ai <your question>\`\n\n` +
        '🌟 Example: `!ai What\'s the weather like today?`'
      );
    }

    const userMessage = args.join(' ');
    
    // Show typing indicator
    const stopTyping = MessageFactory.createTypingIndicator(context.api, event.threadID, 10000);
    
    try {
      const aiIntegration = await AIIntegration.create(process.env.GEMINI_API_KEY || '');
      let response = await aiIntegration.processMessage({
        ...context,
        event: { ...event, body: userMessage }
      });
      
      if (!response) {
        response = 'Sorry, I couldn\'t generate a response. Please try again.';
      }

      // Check if AI wants to execute a command
      response = await aiIntegration.executeCommandIfNeeded(response, context);
      
      stopTyping();
      await message.reply(`🤖 ${response}`);
      
    } catch (error) {
      stopTyping();
      Logger.error('AI_COMMAND', 'AI command failed', error);
      await message.reply('❌ Sorry, I encountered an error. Please try again later.');
    }
  },

  onChat: async (context: MessageContext) => {
    const { event, message } = context;
    
    // Auto-respond to AI mentions in chat
    return async () => {
      try {
        const aiIntegration = await AIIntegration.create(process.env.GEMINI_API_KEY || '');
        const response = await aiIntegration.processMessage(context);
        
        if (response) {
          const finalResponse = await aiIntegration.executeCommandIfNeeded(response, context);
          await message.reply(`🤖 ${finalResponse}`);
        }
      } catch (error) {
        Logger.error('AI_CHAT', 'AI chat handler failed', error);
      }
    };
  }
};

export { AIIntegration, aiCommand };