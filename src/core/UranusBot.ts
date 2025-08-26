import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';
import { BotConfig, Event, Command, DatabaseManager } from '../types/interfaces';
import { Logger } from '../utils/Logger';
import { CommandManager } from './CommandManager';
import { EventHandler } from './EventHandler';
import { DatabaseFactory } from '../database/DatabaseFactory';
import { MessageFactory } from '../utils/MessageFactory';

export class UranusBot extends EventEmitter {
  private config: BotConfig;
  private api: any;
  private botID: string | null = null;
  private commandManager: CommandManager;
  private eventHandler: EventHandler;
  private database?: DatabaseManager;
  private listening: any = null;
  private startTime: number;

  constructor(config: BotConfig) {
    super();
    this.config = config;
    this.startTime = Date.now();
    this.commandManager = new CommandManager();
    this.eventHandler = new EventHandler(this);
  }

  async initialize(): Promise<void> {
    Logger.banner();
    Logger.info('INIT', 'Initializing Uranus Bot...');

    // Initialize database
    this.database = await DatabaseFactory.create(this.config.database);
    Logger.success('DATABASE', 'Database connection established');

    // Load commands and events
    await this.loadScripts();
    Logger.success('SCRIPTS', 'Commands and events loaded');

    // Setup auto-reload if enabled
    if (this.config.features.autoLoadScripts) {
      this.setupAutoReload();
    }
  }

  async start(): Promise<void> {
    // Fix: Use correct import for facebook-chat-api
    const { login } = require('../../facebook-chat-api');

    return new Promise((resolve, reject) => {
      const appStatePath = path.join(process.cwd(), 'appstate.json');

      if (!fs.existsSync(appStatePath)) {
        reject(new Error('appstate.json not found. Please create appstate.json file with your Facebook session data.'));
        return;
      }

      let appState;
      try {
        appState = fs.readJsonSync(appStatePath);
        if (!Array.isArray(appState) || appState.length === 0) {
          throw new Error('Invalid appstate format');
        }
      } catch (error) {
        reject(new Error('Invalid appstate.json format. Please check your appstate file.'));
        return;
      }

      login({ appState }, this.config.facebook.options, async (error: any, api: any) => {
        if (error) {
          Logger.error('LOGIN', 'Failed to login to Facebook', error);
          reject(error);
          return;
        }

        this.api = api;
        this.botID = api.getCurrentUserID();

        Logger.success('LOGIN', `Logged in as ${this.botID}`);
        Logger.info('BOT_INFO', `Bot ID: ${this.botID}`);
        Logger.info('BOT_INFO', `Prefix: ${this.config.prefix}`);
        Logger.info('BOT_INFO', `Language: ${this.config.language}`);

        // Start listening for messages
        this.startListening();

        resolve();
      });
    });
  }

  private startListening(): void {
    this.listening = this.api.listenMqtt((error: any, event: Event) => {
      if (error) {
        Logger.error('LISTEN', 'Listen error', error);
        if (error.error === 'Not logged in') {
          Logger.error('LOGIN', 'Bot was logged out, attempting restart...');
          this.restart();
        }
        return;
      }

      this.handleEvent(event);
    });

    Logger.success('LISTEN', 'Started listening for messages');
  }

  private async handleEvent(event: Event): Promise<void> {
    try {
      // Enhanced event validation and processing
      const processedEvent = this.validateAndProcessEvent(event);
      if (!processedEvent) {
        return; // Skip invalid events
      }

      // Anti-inbox check
      if (this.config.features.antiInbox && !processedEvent.isGroup) {
        return;
      }

      // Create message object
      const message = MessageFactory.create(this.api, processedEvent);

      // Ensure data exists with better error handling
      await this.ensureDataExists(processedEvent);

      // Handle the event
      if (this.database) {
        await this.eventHandler.handle(processedEvent, message, this.database);
      }

    } catch (error) {
      Logger.error('EVENT_HANDLER', 'Error handling event', error);
      // Don't throw - continue processing other events
    }
  }

  // Enhanced event validation and processing
  private validateAndProcessEvent(event: any): Event | null {
    try {
      // Extract and normalize event data
      const processedEvent: Event = {
        type: event.type || 'message',
        threadID: this.extractThreadID(event),
        senderID: this.extractSenderID(event),
        messageID: event.messageID,
        body: event.body,
        isGroup: this.determineIsGroup(event),
        attachments: event.attachments || [],
        mentions: event.mentions || [],
        messageReply: event.messageReply,
        logMessageType: event.logMessageType,
        logMessageData: event.logMessageData,
        participantIDs: event.participantIDs,
        threadName: event.threadName,
        senderName: event.senderName,
        author: event.author,
        ...event // Keep other properties
      };

      // Validate required fields
      if (!processedEvent.threadID) {
        Logger.warn('EVENT_VALIDATION', 'Missing threadID in event', {
          type: event.type,
          logMessageType: event.logMessageType,
          availableKeys: Object.keys(event)
        });
        return null;
      }

      Logger.debug('EVENT_VALIDATION', 'Processed event', {
        type: processedEvent.type,
        threadID: processedEvent.threadID,
        senderID: processedEvent.senderID,
        isGroup: processedEvent.isGroup,
        logMessageType: processedEvent.logMessageType
      });

      return processedEvent;
    } catch (error) {
      Logger.error('EVENT_VALIDATION', 'Error processing event', error);
      return null;
    }
  }

  // Extract threadID from various event formats
  private extractThreadID(event: any): string {
    return String(
      event.threadID ||
      event.thread?.id ||
      event.threadId ||
      event.chatId ||
      ''
    );
  }

  // Extract senderID from various event formats
  private extractSenderID(event: any): string {
    return String(
      event.senderID ||
      event.sender?.id ||
      event.senderId ||
      event.author ||
      event.userID ||
      ''
    );
  }

  // Determine if event is from group chat
  private determineIsGroup(event: any): boolean {
    // Check explicit isGroup field
    if (event.isGroup !== undefined) {
      return event.isGroup;
    }

    // Check thread type indicators
    if (event.threadType === 'GROUP') return true;
    if (event.threadType === 'USER') return false;

    // Check participant count
    if (event.participantIDs && event.participantIDs.length > 2) {
      return true;
    }

    // Default to group for safety (most Facebook chats are groups)
    return true;
  }

  // Enhanced ensureDataExists with better error handling
  private async ensureDataExists(event: Event): Promise<void> {
    if (!this.database) {
      Logger.warn('EVENT', 'Database not initialized');
      return;
    }

    const { threadID, senderID } = event;

    try {
      // Always ensure thread exists first
      await this.ensureThreadExists(threadID, event);

      // Ensure user exists if we have senderID
      if (senderID) {
        await this.ensureUserExists(senderID, event);
      }

    } catch (error) {
      Logger.error('EVENT', 'Error in ensureDataExists', {
        error: error.message,
        threadID,
        senderID,
        eventType: event.type
      });
      // Don't throw - allow event processing to continue
    }
  }

  // Ensure thread exists with comprehensive data
  private async ensureThreadExists(threadID: string, event: Event): Promise<void> {
    try {
      let thread = await this.database!.threads.get(threadID);

      if (!thread) {
        // Get thread info from Facebook API if possible
        let threadInfo: any = {};

        try {
          if (this.api && this.api.getThreadInfo) {
            threadInfo = await this.api.getThreadInfo(threadID);
            Logger.debug('THREAD_CREATION', 'Retrieved thread info from API', {
              threadID,
              threadName: threadInfo.threadName
            });
          }
        } catch (apiError) {
          Logger.warn('THREAD_CREATION', 'Could not get thread info from API', {
            threadID,
            error: apiError.message
          });
        }

        // Create thread with available data
        const threadData = {
          threadName: threadInfo.threadName ||
            event.threadName ||
            `Thread${threadID}`,
          isGroup: event.isGroup,
          adminIDs: threadInfo.adminIDs ||
            event.adminIDs ||
            [],
          members: threadInfo.participantIDs?.map((id: string) => ({
            userID: id,
            name: `User${id}`,
            inGroup: true,
            count: 0
          })) || [],
          participantIDs: threadInfo.participantIDs ||
            event.participantIDs ||
            []
        };

        thread = await this.database!.threads.create(threadID, threadData);

        Logger.info('THREAD_CREATION', `Created new thread: ${threadID}`, {
          threadName: threadData.threadName,
          isGroup: threadData.isGroup,
          memberCount: threadData.members.length
        });
      }

      // Update thread activity
      if (thread) {
        await this.database!.threads.set(threadID, { isActive: true }, 'isActive');
      }

    } catch (error) {
      Logger.error('THREAD_CREATION', `Failed to ensure thread ${threadID}`, error);
      throw error;
    }
  }

  // Ensure user exists with comprehensive data
  private async ensureUserExists(senderID: string, event: Event): Promise<void> {
    try {
      let user = await this.database!.users.get(senderID);

      if (!user) {
        // Get user info from Facebook API if possible
        let userInfo: any = {};

        try {
          if (this.api && this.api.getUserInfo) {
            const userInfoResponse = await this.api.getUserInfo(senderID);
            userInfo = userInfoResponse[senderID] || {};
            Logger.debug('USER_CREATION', 'Retrieved user info from API', {
              senderID,
              name: userInfo.name
            });
          }
        } catch (apiError) {
          Logger.warn('USER_CREATION', 'Could not get user info from API', {
            senderID,
            error: apiError.message
          });
        }

        // Create user with available data
        const userData = {
          name: userInfo.name ||
            event.senderName ||
            `User${senderID}`,
          profileUrl: userInfo.profileUrl || '',
          vanity: userInfo.vanity || '',
          thumbSrc: userInfo.thumbSrc || ''
        };

        user = await this.database!.users.create(senderID, userData);

        Logger.info('USER_CREATION', `Created new user: ${senderID}`, {
          name: userData.name
        });
      }

    } catch (error) {
      Logger.error('USER_CREATION', `Failed to ensure user ${senderID}`, error);
      // Don't throw for user creation failures - thread is more important
    }
  }

  private async loadScripts(): Promise<void> {
    const scriptsPath = path.join(process.cwd(), 'src', 'scripts');

    // Load commands
    const commandsPath = path.join(scriptsPath, 'commands');
    if (await fs.pathExists(commandsPath)) {
      await this.loadCommandsFromDirectory(commandsPath);
    }

    // Load events
    const eventsPath = path.join(scriptsPath, 'events');
    if (await fs.pathExists(eventsPath)) {
      await this.loadEventsFromDirectory(eventsPath);
    }
  }

  private async loadCommandsFromDirectory(directory: string): Promise<void> {
    const files = await fs.readdir(directory);
    const tsFiles = files.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'));

    for (const file of tsFiles) {
      try {
        const filePath = path.join(directory, file);

        // Clear require cache for hot reload
        delete require.cache[require.resolve(filePath)];

        const commandModule = require(filePath);
        const command: Command = commandModule.default || commandModule;

        if (this.validateCommand(command)) {
          this.commandManager.register(command);
          Logger.success('COMMAND', `Loaded: ${command.config.name}`);
        } else {
          Logger.warn('COMMAND', `Invalid command structure in ${file}`);
        }
      } catch (error) {
        Logger.error('COMMAND', `Failed to load ${file}`, error);
      }
    }
  }

  private async loadEventsFromDirectory(directory: string): Promise<void> {
    const files = await fs.readdir(directory);
    const tsFiles = files.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'));

    for (const file of tsFiles) {
      try {
        const filePath = path.join(directory, file);

        // Clear require cache for hot reload
        delete require.cache[require.resolve(filePath)];

        const eventModule = require(filePath);
        const event = eventModule.default || eventModule;

        if (this.validateEvent(event)) {
          this.eventHandler.registerEvent(event);
          Logger.success('EVENT', `Loaded: ${event.config.name}`);
        } else {
          Logger.warn('EVENT', `Invalid event structure in ${file}`);
        }
      } catch (error) {
        Logger.error('EVENT', `Failed to load ${file}`, error);
      }
    }
  }

  private validateCommand(command: Command): boolean {
    if (!command || !command.config) {
      Logger.error('COMMAND', 'Command missing config');
      return false;
    }

    const { name, description, category } = command.config;
    if (!name || !description || !category) {
      Logger.error('COMMAND', 'Command missing required config fields (name, description, category)');
      return false;
    }

    if (typeof command.onStart !== 'function') {
      Logger.error('COMMAND', `Command ${name} missing onStart function`);
      return false;
    }

    return true;
  }

  // Fix: Add validateEvent method
  private validateEvent(event: any): boolean {
    if (!event || !event.config) {
      Logger.error('EVENT', 'Event missing config');
      return false;
    }

    const { name } = event.config;
    if (!name) {
      Logger.error('EVENT', 'Event missing name');
      return false;
    }

    // Event should have at least one handler
    if (!event.onChat && !event.onEvent && !event.onStart) {
      Logger.error('EVENT', `Event ${name} missing handler functions`);
      return false;
    }

    return true;
  }

  private setupAutoReload(): void {
    const scriptsPath = path.join(process.cwd(), 'src', 'scripts');

    if (fs.existsSync(scriptsPath)) {
      fs.watch(scriptsPath, { recursive: true }, async (eventType, filename) => {
        if (!filename || !filename.endsWith('.ts')) return;

        if (eventType === 'change') {
          Logger.info('AUTO_RELOAD', `Reloading ${filename}...`);

          try {
            if (filename.includes('commands/')) {
              await this.reloadCommand(filename);
            } else if (filename.includes('events/')) {
              await this.reloadEvent(filename);
            }
          } catch (error) {
            Logger.error('AUTO_RELOAD', `Failed to reload ${filename}`, error);
          }
        }
      });

      Logger.info('AUTO_RELOAD', 'Auto-reload enabled');
    }
  }

  private async reloadCommand(filename: string): Promise<void> {
    const commandPath = path.join(process.cwd(), 'src', 'scripts', filename);

    if (await fs.pathExists(commandPath)) {
      delete require.cache[require.resolve(commandPath)];
      const commandModule = require(commandPath);
      const command: Command = commandModule.default || commandModule;

      if (this.validateCommand(command)) {
        this.commandManager.register(command);
        Logger.success('AUTO_RELOAD', `Command ${command.config.name} reloaded`);
      }
    }
  }

  private async reloadEvent(filename: string): Promise<void> {
    const eventPath = path.join(process.cwd(), 'src', 'scripts', filename);

    if (await fs.pathExists(eventPath)) {
      delete require.cache[require.resolve(eventPath)];
      const eventModule = require(eventPath);
      const event = eventModule.default || eventModule;

      if (this.validateEvent(event)) {
        this.eventHandler.registerEvent(event);
        Logger.success('AUTO_RELOAD', `Event ${event.config.name} reloaded`);
      }
    }
  }

  async restart(): Promise<void> {
    Logger.info('RESTART', 'Restarting bot...');

    try {
      if (this.listening) {
        this.api.logout(() => {
          Logger.info('RESTART', 'Logged out successfully');
        });
        this.listening = null;
      }
    } catch (error) {
      Logger.error('RESTART', 'Error during logout', error);
    }

    process.exit(2);
  }

  // Fix: Add cleanup method
  async cleanup(): Promise<void> {
    Logger.info('CLEANUP', 'Cleaning up resources...');

    try {
      if (this.listening) {
        this.api.stopListening();
        this.listening = null;
      }

      // Cleanup command manager
      this.commandManager.cleanup();

      // Cleanup event handler
      this.eventHandler.cleanup();

      // Cleanup message factory
      await MessageFactory.shutdown();

      // Close database connections if needed
      if (this.database && typeof (this.database as any).close === 'function') {
        await (this.database as any).close();
      }

      Logger.info('CLEANUP', 'Cleanup completed');
    } catch (error) {
      Logger.error('CLEANUP', 'Error during cleanup', error);
    }
  }

  // Getters
  getAPI(): any {
    return this.api;
  }

  getBotID(): string | null {
    return this.botID;
  }

  getCommandManager(): CommandManager {
    return this.commandManager;
  }

  getEventHandler(): EventHandler {
    return this.eventHandler;
  }

  getDatabase(): DatabaseManager | undefined {
    return this.database;
  }

  getConfig(): BotConfig {
    return this.config;
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  isReady(): boolean {
    return !!(this.api && this.botID && this.database);
  }

  // Health check method
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: {
      api: boolean;
      database: boolean;
      listening: boolean;
      uptime: number;
    };
  } {
    const details = {
      api: !!this.api,
      database: !!this.database,
      listening: !!this.listening,
      uptime: this.getUptime()
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!details.api || !details.database) {
      status = 'unhealthy';
    } else if (!details.listening) {
      status = 'degraded';
    }

    return { status, details };
  }

  // Get bot statistics
  getStats(): {
    uptime: number;
    commands: number;
    events: number;
    threads: number;
    users: number;
  } {
    return {
      uptime: this.getUptime(),
      commands: this.commandManager.getStats().totalCommands,
      events: this.eventHandler.getEventCount(),
      threads: 0, // Will be populated by database query if needed
      users: 0    // Will be populated by database query if needed
    };
  }
}