import { GoogleGenerativeAI } from '@google/generative-ai';
import { MessageContext, Command, UserData, ThreadData } from '../types/interfaces';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';
import { MessageFactory } from '../utils/MessageFactory';

export interface AIConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  features: {
    commandExecution: boolean;
    userAnalysis: boolean;
    contextMemory: boolean;
    multiLanguage: boolean;
  };
}

export interface AIContext {
  user: UserData;
  thread: ThreadData;
  recentMessages: Array<{
    senderID: string;
    senderName: string;
    message: string;
    timestamp: number;
  }>;
  availableCommands: Command[];
  groupStats: {
    totalMembers: number;
    activeMembers: number;
    messageCount: number;
  };
}

class AIIntegration {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private config: AIConfig;
  private conversationHistory: Map<string, Array<{ role: 'user' | 'assistant', content: string, timestamp: number }>> = new Map();
  private userProfiles: Map<string, UserProfile> = new Map();
  private commandUsage: Map<string, number> = new Map();

  constructor(config: AIConfig) {
    this.config = config;
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: config.model });

    // Initialize command usage tracking
    this.initializeCommandTracking();
  }

  async processMessage(context: MessageContext): Promise<string | null> {
    const { event, userData, threadData } = context;

    try {
      // Check if AI should respond
      if (!this.shouldRespond(event, threadData)) {
        return null;
      }

      // Build comprehensive AI context
      const aiContext = await this.buildAIContext(context);

      // Update conversation history
      this.updateConversationHistory(context.threadData.threadID, 'user', event.body || '', userData.name);

      // Generate AI response
      const response = await this.generateResponse(context, aiContext);

      // Process any commands in the response
      const processedResponse = await this.processAICommands(response, context);

      // Update conversation history with AI response
      this.updateConversationHistory(context.threadData.threadID, 'assistant', processedResponse);

      // Update user interaction stats
      await this.updateUserStats(context);

      return processedResponse;

    } catch (error) {
      Logger.error('AI_INTEGRATION', 'Failed to process message', error);
      return this.getErrorResponse(error);
    }
  }

  private shouldRespond(event: any, threadData: ThreadData): boolean {
    const { body, mentions } = event;

    if (!body) return false;

    const botID = (global as any).bot?.getBotID();

    // Always respond to direct mentions
    if (mentions && botID && mentions.some((mention: any) => mention.id === botID)) {
      return true;
    }

    // Respond in private messages
    if (!event.isGroup) {
      return true;
    }

    // Check AI triggers in group
    const aiSettings = threadData.data?.aiSettings || {};
    const aiTriggers = aiSettings.triggers || ['ai', 'uranus', 'bot'];
    const autoRespond = aiSettings.autoRespond || false;

    const lowerBody = body.toLowerCase();

    // Check for triggers
    const hasTrigger = aiTriggers.some((trigger: string) =>
      lowerBody.includes(trigger.toLowerCase())
    );

    // Auto respond based on settings
    const shouldAutoRespond = autoRespond && Math.random() < 0.1; // 10% chance

    return hasTrigger || shouldAutoRespond;
  }

  private async buildAIContext(context: MessageContext): Promise<AIContext> {
    const { userData, threadData, event } = context;
    const database = (global as any).bot?.getDatabase();

    // Get recent messages for context
    const recentMessages = await this.getRecentMessages(threadData.threadID);

    // Get available commands based on user role
    const availableCommands = this.getAvailableCommands(context);

    // Calculate group statistics
    const groupStats = await this.calculateGroupStats(threadData, database);

    // Update user profile
    await this.updateUserProfile(userData, event);

    return {
      user: userData,
      thread: threadData,
      recentMessages,
      availableCommands,
      groupStats
    };
  }

  private async generateResponse(context: MessageContext, aiContext: AIContext): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context, aiContext);
    const userMessage = this.buildUserMessage(context, aiContext);

    const fullPrompt = `${systemPrompt}\n\nUser Message: "${context.event.body}"\n\n${userMessage}`;

    const result = await this.model.generateContent(fullPrompt);
    const response = result.response.text();

    // Apply response filters and improvements
    return this.enhanceResponse(response, context, aiContext);
  }

  private buildSystemPrompt(context: MessageContext, aiContext: AIContext): string {
    const { userData, threadData } = context;
    const userProfile = this.userProfiles.get(userData.userID);
    const conversationHistory = this.getRecentConversation(threadData.threadID);

    return `
🤖 **URANUS BOT AI ASSISTANT**

**Current Context:**
• User: ${userData.name} (ID: ${userData.userID})
• Level: ${this.calculateLevel(userData.exp || 0)} (${Utils.formatNumber(userData.exp || 0)} XP)
• Balance: ${Utils.formatNumber(userData.money || 0)} coins
• Group: ${threadData.threadName} (${threadData.isGroup ? 'Group Chat' : 'Private Chat'})
• Members: ${aiContext.groupStats.totalMembers} total, ${aiContext.groupStats.activeMembers} active
• Messages Today: ${aiContext.groupStats.messageCount}

**User Profile:**
${userProfile ? `
• Preferred Language: ${userProfile.preferredLanguage}
• Activity Level: ${userProfile.activityLevel}
• Favorite Commands: ${userProfile.favoriteCommands.slice(0, 3).join(', ')}
• Interaction Style: ${userProfile.interactionStyle}
• Last Seen: ${Utils.getTimeAgo(userProfile.lastSeen)}
` : 'New user - building profile...'}

**Available Commands:**
${aiContext.availableCommands.map(cmd =>
      `• !${cmd.config.name}: ${cmd.config.description}`
    ).slice(0, 10).join('\n')}

**Recent Conversation:**
${conversationHistory.map(msg =>
      `${msg.role === 'user' ? '👤' : '🤖'} ${msg.content.substring(0, 100)}...`
    ).join('\n')}

**AI Capabilities & Guidelines:**
1. **Personality**: Be helpful, friendly, and engaging. Use appropriate emojis.
2. **Language**: Respond in Vietnamese if user writes in Vietnamese, otherwise English.
3. **Commands**: Suggest relevant commands when appropriate using format: \`!command\`
4. **Memory**: Reference past interactions when relevant.
5. **Analysis**: Provide insights about user activity, group dynamics when asked.
6. **Limits**: Keep responses under 2000 characters unless specifically asked for detailed info.
7. **Privacy**: Never share personal information between users without permission.
8. **Moderation**: Maintain a positive, respectful conversation environment.

**Special Functions:**
• User Analysis: Can analyze user behavior, activity patterns, preferences
• Command Execution: Can suggest and explain commands
• Group Insights: Can provide statistics and insights about group activity
• Learning: Continuously learns from interactions to improve responses
• Multi-language: Supports Vietnamese, English, and basic other languages

**Response Style:**
• Be conversational and natural
• Use emojis appropriately (but not excessively)  
• Provide helpful suggestions
• Ask follow-up questions when appropriate
• Reference user's history and preferences when relevant
    `.trim();
  }

  private buildUserMessage(context: MessageContext, aiContext: AIContext): string {
    const { event, userData } = context;

    let message = `**Additional Context:**\n`;

    // Add message type context
    if (event.messageReply) {
      message += `• Replying to a previous message\n`;
    }

    if (event.attachments && event.attachments.length > 0) {
      message += `• Message contains ${event.attachments.length} attachment(s)\n`;
    }

    // Add user activity context
    const userProfile = this.userProfiles.get(userData.userID);
    if (userProfile) {
      message += `• User typically ${userProfile.activityLevel} active\n`;
      message += `• Prefers ${userProfile.interactionStyle} interactions\n`;
    }

    // Add recent group activity
    if (aiContext.recentMessages.length > 0) {
      message += `• Recent group activity: ${aiContext.recentMessages.length} messages in last hour\n`;
    }

    return message;
  }

  private async processAICommands(response: string, context: MessageContext): Promise<string> {
    if (!this.config.features.commandExecution) {
      return response;
    }

    const commandRegex = /!(\w+)(?:\s+([^!]+?))?(?=\s*!|\s*$)/g;
    let processedResponse = response;
    const commandManager = (global as any).bot?.getCommandManager();

    if (!commandManager) {
      return response;
    }

    const matches = Array.from(response.matchAll(commandRegex));

    for (const match of matches) {
      const [fullMatch, commandName, commandArgs] = match;
      const command = commandManager.get(commandName);

      if (command) {
        try {
          // Check if user has permission
          const requiredRole = command.config.role || 0;
          if (requiredRole <= context.role) {
            // Create command context
            const commandContext = {
              ...context,
              args: commandArgs ? commandArgs.trim().split(/\s+/) : [],
              commandName: command.config.name
            };

            // Execute command silently
            await command.onStart(commandContext);

            // Replace in response
            processedResponse = processedResponse.replace(
              fullMatch,
              `✅ Executed: \`${fullMatch}\``
            );

            // Track command usage
            this.trackCommandUsage(commandName, context.userData.userID);

          } else {
            processedResponse = processedResponse.replace(
              fullMatch,
              `❌ Insufficient permission for: \`${fullMatch}\``
            );
          }
        } catch (error) {
          Logger.error('AI_COMMAND', `Failed to execute AI command ${commandName}`, error);
          processedResponse = processedResponse.replace(
            fullMatch,
            `⚠️ Failed to execute: \`${fullMatch}\``
          );
        }
      }
    }

    return processedResponse;
  }

  private enhanceResponse(response: string, context: MessageContext, aiContext: AIContext): string {
    let enhanced = response;

    // Add personalization based on user profile
    const userProfile = this.userProfiles.get(context.userData.userID);
    if (userProfile) {
      // Adjust language style
      if (userProfile.interactionStyle === 'formal') {
        enhanced = enhanced.replace(/hey|hi/gi, 'Hello');
      } else if (userProfile.interactionStyle === 'casual') {
        enhanced = enhanced.replace(/Hello/g, 'Hey');
      }
    }

    // Add contextual suggestions
    if (enhanced.length < 500) {
      const suggestions = this.generateContextualSuggestions(context, aiContext);
      if (suggestions.length > 0) {
        enhanced += `\n\n💡 **Suggestions:**\n${suggestions.slice(0, 3).join('\n')}`;
      }
    }

    // Ensure response length limit
    if (enhanced.length > 2000) {
      enhanced = enhanced.substring(0, 1900) + '... (truncated for length)';
    }

    return enhanced;
  }

  private generateContextualSuggestions(context: MessageContext, aiContext: AIContext): string[] {
    const suggestions: string[] = [];
    const { userData, threadData } = context;

    // Command suggestions based on user level and activity
    if ((userData.exp || 0) < 100) {
      suggestions.push('• Try `!help` to see all available commands');
    }

    if ((userData.money || 0) < 1000) {
      suggestions.push('• Use `!daily` to earn daily coins');
    }

    // Group-specific suggestions
    if (threadData.isGroup && aiContext.groupStats.activeMembers > 5) {
      suggestions.push('• Check `!rank` to see your position in the group');
    }

    // Activity-based suggestions
    const userProfile = this.userProfiles.get(userData.userID);
    if (userProfile && userProfile.favoriteCommands.length > 0) {
      const favCommand = userProfile.favoriteCommands[0];
      suggestions.push(`• You often use \`!${favCommand}\` - try it again!`);
    }

    return suggestions;
  }

  private async getRecentMessages(threadID: string): Promise<Array<{
    senderID: string;
    senderName: string;
    message: string;
    timestamp: number;
  }>> {
    // In a real implementation, this would fetch from database
    // For now, return empty array or mock data
    return [];
  }

  private getAvailableCommands(context: MessageContext): Command[] {
    const commandManager = (global as any).bot?.getCommandManager();
    if (!commandManager) return [];

    return commandManager.getAll().filter((cmd: Command) =>
      (cmd.config.role || 0) <= context.role
    );
  }

  private async calculateGroupStats(threadData: ThreadData, database: any): Promise<{
    totalMembers: number;
    activeMembers: number;
    messageCount: number;
  }> {
    return {
      totalMembers: threadData.members?.length || 0,
      activeMembers: threadData.members?.filter(m => m.inGroup).length || 0,
      messageCount: 0 // Would be calculated from database in real implementation
    };
  }

  private calculateLevel(exp: number): number {
    return Math.floor(Math.sqrt(exp / 100));
  }

  private updateConversationHistory(threadID: string, role: 'user' | 'assistant', content: string, userName?: string): void {
    if (!this.config.features.contextMemory) return;

    if (!this.conversationHistory.has(threadID)) {
      this.conversationHistory.set(threadID, []);
    }

    const history = this.conversationHistory.get(threadID)!;
    const entry = {
      role,
      content: userName ? `${userName}: ${content}` : content,
      timestamp: Date.now()
    };

    history.push(entry);

    // Keep only last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Clean old messages (older than 24 hours)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.conversationHistory.set(
      threadID,
      history.filter(msg => msg.timestamp > dayAgo)
    );
  }

  private getRecentConversation(threadID: string): Array<{ role: 'user' | 'assistant', content: string }> {
    const history = this.conversationHistory.get(threadID) || [];
    return history.slice(-5); // Return last 5 messages
  }

  private async updateUserProfile(userData: UserData, event: any): Promise<void> {
    if (!this.config.features.userAnalysis) return;

    const userID = userData.userID;
    let profile = this.userProfiles.get(userID) || this.createDefaultProfile(userID);

    // Update basic info
    profile.lastSeen = Date.now();
    profile.messageCount++;
    profile.totalInteractions++;

    // Analyze message for language preference
    if (event.body) {
      const language = this.detectLanguage(event.body);
      if (language !== profile.preferredLanguage) {
        profile.languageHistory[language] = (profile.languageHistory[language] || 0) + 1;

        // Update preferred language if this one is more common
        const mostUsed = Object.entries(profile.languageHistory)
          .sort(([, a], [, b]) => b - a)[0][0];
        profile.preferredLanguage = mostUsed;
      }
    }

    // Update activity level
    profile.activityLevel = this.calculateActivityLevel(profile);

    // Update interaction style
    profile.interactionStyle = this.analyzeInteractionStyle(event.body || '');

    this.userProfiles.set(userID, profile);
  }

  private createDefaultProfile(userID: string): UserProfile {
    return {
      userID,
      preferredLanguage: 'en',
      activityLevel: 'moderate',
      interactionStyle: 'friendly',
      favoriteCommands: [],
      lastSeen: Date.now(),
      messageCount: 0,
      totalInteractions: 0,
      languageHistory: {},
      commandHistory: {},
      topics: []
    };
  }

  private detectLanguage(text: string): string {
    // Simple language detection
    const vietnameseChars = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

    if (vietnameseChars.test(text)) {
      return 'vi';
    }

    return 'en';
  }

  private calculateActivityLevel(profile: UserProfile): 'low' | 'moderate' | 'high' | 'very_high' {
    const now = Date.now();
    const daysSinceLastSeen = (now - profile.lastSeen) / (24 * 60 * 60 * 1000);

    if (daysSinceLastSeen < 1 && profile.messageCount > 10) return 'very_high';
    if (daysSinceLastSeen < 3 && profile.messageCount > 5) return 'high';
    if (daysSinceLastSeen < 7) return 'moderate';
    return 'low';
  }

  private analyzeInteractionStyle(text: string): 'formal' | 'casual' | 'friendly' | 'professional' {
    const lower = text.toLowerCase();

    if (/please|thank you|would you|could you/.test(lower)) return 'formal';
    if (/hey|yo|sup|lol|haha/.test(lower)) return 'casual';
    if (/report|analysis|data|statistics/.test(lower)) return 'professional';

    return 'friendly';
  }

  private async updateUserStats(context: MessageContext): Promise<void> {
    const database = (global as any).bot?.getDatabase();
    if (!database) return;

    try {
      // Add small XP for AI interaction
      await database.users.addExp(context.userData.userID, 2);

      // Update interaction count in user data
      const currentData = context.userData.data || {};
      currentData.aiInteractions = (currentData.aiInteractions || 0) + 1;
      currentData.lastAIChat = Date.now();

      await database.users.set(context.userData.userID, currentData, 'data');

    } catch (error) {
      Logger.warn('AI_STATS', 'Failed to update user stats', error);
    }
  }

  private trackCommandUsage(commandName: string, userID: string): void {
    const key = `${userID}:${commandName}`;
    this.commandUsage.set(key, (this.commandUsage.get(key) || 0) + 1);

    // Update user profile
    const profile = this.userProfiles.get(userID);
    if (profile) {
      profile.commandHistory[commandName] = (profile.commandHistory[commandName] || 0) + 1;

      // Update favorite commands
      profile.favoriteCommands = Object.entries(profile.commandHistory)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([cmd]) => cmd);
    }
  }

  private getErrorResponse(error: any): string {
    const errorResponses = [
      "Xin lỗi, tôi đang gặp một chút trục trặc. Hãy thử lại sau nhé! 😅",
      "Oops! Something went wrong. Let me try to help you differently! 🤖",
      "Có vẻ như AI của tôi đang hơi confused. Bạn có thể hỏi lại không? 🤔",
      "Sorry, I'm having a temporary glitch. Please try again! ⚡"
    ];

    return Utils.getRandomElement(errorResponses);
  }

  private initializeCommandTracking(): void {
    // Initialize tracking for popular commands
    const popularCommands = ['help', 'balance', 'daily', 'rank', 'ping'];
    popularCommands.forEach(cmd => {
      this.commandUsage.set(`system:${cmd}`, 0);
    });
  }

  // Public methods for external usage

  async getUserAnalysis(userID: string): Promise<UserProfile | null> {
    return this.userProfiles.get(userID) || null;
  }

  async getConversationSummary(threadID: string): Promise<string> {
    const history = this.conversationHistory.get(threadID) || [];
    if (history.length === 0) return "No conversation history available.";

    const summary = {
      totalMessages: history.length,
      timespan: this.calculateTimespan(history),
      topics: this.extractTopics(history),
      sentiment: this.analyzeSentiment(history)
    };

    return `**Conversation Summary:**\n` +
      `• Messages: ${summary.totalMessages}\n` +
      `• Timespan: ${summary.timespan}\n` +
      `• Topics: ${summary.topics.join(', ')}\n` +
      `• Sentiment: ${summary.sentiment}`;
  }

  async getGroupInsights(threadID: string): Promise<string> {
    const database = (global as any).bot?.getDatabase();
    if (!database) return "Database not available for insights.";

    try {
      const threadData = await database.threads.get(threadID);
      const insights = await this.analyzeGroupActivity(threadData);

      return `**Group Insights:**\n` +
        `• Activity Level: ${insights.activityLevel}\n` +
        `• Most Active Time: ${insights.peakTime}\n` +
        `• Popular Commands: ${insights.popularCommands.join(', ')}\n` +
        `• Member Engagement: ${insights.engagement}%`;
    } catch (error) {
      Logger.error('AI_INSIGHTS', 'Failed to generate group insights', error);
      return "Unable to generate insights at this time.";
    }
  }

  private calculateTimespan(history: any[]): string {
    if (history.length < 2) return "Just started";

    const oldest = Math.min(...history.map(h => h.timestamp));
    const newest = Math.max(...history.map(h => h.timestamp));

    return Utils.getTimeAgo(oldest);
  }

  private extractTopics(history: any[]): string[] {
    // Simple topic extraction based on keywords
    const topicKeywords: Record<string, string[]> = {
      'gaming': ['game', 'play', 'gaming', 'level', 'score'],
      'economy': ['money', 'coin', 'balance', 'daily', 'rich'],
      'help': ['help', 'command', 'how', 'what', 'guide'],
      'social': ['hello', 'hi', 'how are you', 'thanks', 'good']
    };

    const topics: string[] = [];
    const allText = history.map(h => h.content).join(' ').toLowerCase();

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(keyword => allText.includes(keyword))) {
        topics.push(topic);
      }
    }

    return topics.length > 0 ? topics : ['general chat'];
  }

  private analyzeSentiment(history: any[]): string {
    // Simple sentiment analysis
    const positive = ['good', 'great', 'awesome', 'love', 'like', 'happy', 'thanks'];
    const negative = ['bad', 'terrible', 'hate', 'sad', 'angry', 'annoying'];

    let positiveScore = 0;
    let negativeScore = 0;

    const allText = history.map(h => h.content).join(' ').toLowerCase();

    positive.forEach(word => {
      if (allText.includes(word)) positiveScore++;
    });

    negative.forEach(word => {
      if (allText.includes(word)) negativeScore++;
    });

    if (positiveScore > negativeScore) return '😊 Positive';
    if (negativeScore > positiveScore) return '😔 Negative';
    return '😐 Neutral';
  }

  private async analyzeGroupActivity(threadData: ThreadData): Promise<{
    activityLevel: string;
    peakTime: string;
    popularCommands: string[];
    engagement: number;
  }> {
    // Mock analysis - in real implementation would analyze database
    return {
      activityLevel: 'High',
      peakTime: '8-10 PM',
      popularCommands: ['help', 'balance', 'daily'],
      engagement: 75
    };
  }

  // Cleanup method
  cleanup(): void {
    this.conversationHistory.clear();
    this.userProfiles.clear();
    this.commandUsage.clear();
    Logger.info('AI_INTEGRATION', 'AI Integration cleaned up');
  }

  // Static factory method
  static async create(apiKey: string, customConfig?: Partial<AIConfig>): Promise<AIIntegration> {
    const defaultConfig: AIConfig = {
      apiKey,
      model: 'gemini-pro',
      maxTokens: 1000,
      temperature: 0.7,
      features: {
        commandExecution: true,
        userAnalysis: true,
        contextMemory: true,
        multiLanguage: true
      }
    };

    const config = { ...defaultConfig, ...customConfig };
    return new AIIntegration(config);
  }
}

// User Profile Interface
interface UserProfile {
  userID: string;
  preferredLanguage: string;
  activityLevel: 'low' | 'moderate' | 'high' | 'very_high';
  interactionStyle: 'formal' | 'casual' | 'friendly' | 'professional';
  favoriteCommands: string[];
  lastSeen: number;
  messageCount: number;
  totalInteractions: number;
  languageHistory: Record<string, number>;
  commandHistory: Record<string, number>;
  topics: string[];
}

// Enhanced AI Command
const aiCommand: Command = {
  config: {
    name: 'ai',
    aliases: ['ask', 'chat', 'gpt', 'uranus'],
    description: 'Chat with Uranus AI assistant with advanced features',
    usage: 'ai <message> | ai analyze @user | ai summary | ai insights',
    category: 'ai',
    role: 0,
    cooldown: 3,
    version: '2.0.0',
    author: 'Uranus Bot Team'
  },

  onStart: async (context: MessageContext) => {
    const { args, message, event, userData, threadData } = context;

    if (args.length === 0) {
      return await message.reply(
        '🤖 **Uranus AI Assistant v2.0**\n\n' +
        '🌟 **Enhanced Features:**\n' +
        '• Smart conversation with context memory\n' +
        '• Command execution and suggestions\n' +
        '• User behavior analysis\n' +
        '• Multi-language support (EN/VI)\n' +
        '• Group insights and statistics\n\n' +
        '💬 **Usage Examples:**\n' +
        `• \`${context.prefix}ai Hello, how are you?\`\n` +
        `• \`${context.prefix}ai analyze @user\` - Analyze user behavior\n` +
        `• \`${context.prefix}ai summary\` - Conversation summary\n` +
        `• \`${context.prefix}ai insights\` - Group insights\n\n` +
        '🎯 **Just mention me or use AI triggers in chat for auto-response!**'
      );
    }

    const subCommand = args[0].toLowerCase();

    try {
      const aiIntegration = await AIIntegration.create(
        process.env.GEMINI_API_KEY || '',
        {
          features: {
            commandExecution: true,
            userAnalysis: true,
            contextMemory: true,
            multiLanguage: true
          }
        }
      );

      // Handle special commands
      switch (subCommand) {
        case 'analyze':
          await handleUserAnalysis(aiIntegration, context);
          break;

        case 'summary':
          await handleConversationSummary(aiIntegration, context);
          break;

        case 'insights':
          await handleGroupInsights(aiIntegration, context);
          break;

        default:
          await handleNormalChat(aiIntegration, context);
      }

    } catch (error) {
      Logger.error('AI_COMMAND', 'AI command failed', error);
      await message.reply('❌ AI service temporarily unavailable. Please try again later.');
    }
  },

  onChat: async (context: MessageContext) => {
    // Auto-respond to AI mentions in chat
    return async () => {
      try {
        const aiIntegration = await AIIntegration.create(process.env.GEMINI_API_KEY || '');
        const response = await aiIntegration.processMessage(context);

        if (response) {
          await context.message.reply(`🤖 ${response}`);
        }
      } catch (error) {
        Logger.error('AI_CHAT', 'AI chat handler failed', error);
      }
    };
  }
};

// Helper functions for AI command
async function handleUserAnalysis(aiIntegration: AIIntegration, context: MessageContext): Promise<void> {
  const { event, message } = context;
  let targetUserID = context.userData.userID;

  // Check if analyzing another user
  if (event.messageReply) {
    targetUserID = event.messageReply.senderID;
  }

  const analysis = await aiIntegration.getUserAnalysis(targetUserID);
  const database = (global as any).bot?.getDatabase();

  if (!analysis || !database) {
    return await message.reply('❌ No analysis data available for this user.');
  }

  const targetUser = await database.users.get(targetUserID);
  if (!targetUser) {
    return await message.reply('❌ User not found in database.');
  }

  const analysisText =
    `📊 **User Analysis: ${targetUser.name}**\n\n` +
    `🗣️ **Language:** ${analysis.preferredLanguage === 'vi' ? 'Vietnamese' : 'English'}\n` +
    `⚡ **Activity:** ${analysis.activityLevel.replace('_', ' ')}\n` +
    `💬 **Style:** ${analysis.interactionStyle}\n` +
    `📈 **Messages:** ${Utils.formatNumber(analysis.messageCount)}\n` +
    `🎮 **Top Commands:** ${analysis.favoriteCommands.slice(0, 3).join(', ')}\n` +
    `🕒 **Last Seen:** ${Utils.getTimeAgo(analysis.lastSeen)}\n` +
    `💰 **Level:** ${Math.floor(Math.sqrt(targetUser.exp / 100))} (${Utils.formatNumber(targetUser.exp)} XP)\n` +
    `🏆 **Balance:** ${Utils.formatNumber(targetUser.money)} coins`;

  await message.reply(analysisText);
}

async function handleConversationSummary(aiIntegration: AIIntegration, context: MessageContext): Promise<void> {
  const summary = await aiIntegration.getConversationSummary(context.threadData.threadID);
  await context.message.reply(`📝 ${summary}`);
}

async function handleGroupInsights(aiIntegration: AIIntegration, context: MessageContext): Promise<void> {
  if (!context.threadData.isGroup) {
    return await context.message.reply('❌ This command is only available in group chats.');
  }

  const insights = await aiIntegration.getGroupInsights(context.threadData.threadID);
  await context.message.reply(`📊 ${insights}`);
}

async function handleNormalChat(aiIntegration: AIIntegration, context: MessageContext): Promise<void> {
  const { message, event } = context;
  const userMessage = context.args.join(' ');

  // Show typing indicator
  const stopTyping = MessageFactory.createTypingIndicator(context.api, event.threadID, 8000);

  try {
    // Update the event body to include the user's message
    const modifiedContext = {
      ...context,
      event: { ...event, body: userMessage }
    };

    let response = await aiIntegration.processMessage(modifiedContext);

    if (!response) {
      response = 'Tôi không thể hiểu câu hỏi của bạn. Hãy thử hỏi cách khác nhé! 🤔';
    }

    stopTyping();
    await message.reply(`🤖 ${response}`);

  } catch (error) {
    stopTyping();
    Logger.error('AI_NORMAL_CHAT', 'Normal chat failed', error);
    await message.reply('❌ Có lỗi xảy ra khi xử lý tin nhắn. Vui lòng thử lại sau!');
  }
}

export { AIIntegration, aiCommand };