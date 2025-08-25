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
    const { login } = require('../../facebook-chat-api');
    
    return new Promise((resolve, reject) => {
      const appStatePath = path.join(process.cwd(), 'appstate.json');
      
      if (!fs.existsSync(appStatePath)) {
        reject(new Error('appstate.json not found'));
        return;
      }

      const appState = fs.readJsonSync(appStatePath);
      
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
      // Anti-inbox check
      if (this.config.features.antiInbox && !event.isGroup) {
        return;
      }

      // Create message object
      const message = MessageFactory.create(this.api, event);

      // Check and create user/thread data if needed
      await this.ensureDataExists(event);

      // Handle the event
      await this.eventHandler.handle(event, message, this.database);

    } catch (error) {
      Logger.error('EVENT_HANDLER', 'Error handling event', error);
    }
  }

  private async ensureDataExists(event: any): Promise<void> {
    const userID = String(event?.senderID || event?.sender?.id || "");
    const threadID = String(event?.threadID || event?.thread?.id || "");
    if (!userID || !threadID) {
      Logger.warn('[EVENT] ',"Missing senderID or threadID");
      return;
    }

    // USER
    let user = await this.database.users.get(userID);
    if (!user) {
      try {
        user = await this.database.users.create(userID, {
          name: event?.senderName || `User${userID}`,
        });
      } catch (e) {
        // Trường hợp lock hoặc race: đọc lại
        Logger.warn('[ensureDataExists]',` create user failed: ${String(e)}`);
        user = await this.database.users.get(userID);
      }
    }

    // THREAD
    let thread = await this.database.threads.get(threadID);
    if (!thread) {
      try {
        thread = await this.database.threads.create(threadID, {
          threadName: event?.threadName || `Thread${threadID}`,
          isGroup: event?.isGroup !== false,
        });
      } catch (e) {
        Logger.warn('[ensureDataExists]', ` create thread failed: ${String(e)}`);
        thread = await this.database.threads.get(threadID);
      }
    }

    if (!user || !thread) {
      Logger.warn('EVENT',"Missing user or thread data");
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
        delete require.cache[require.resolve(filePath)];
        
        const commandModule = require(filePath);
        const command: Command = commandModule.default || commandModule;

        if (this.validateCommand(command)) {
          this.commandManager.register(command);
          Logger.success('COMMAND', `Loaded: ${command.config.name}`);
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
        delete require.cache[require.resolve(filePath)];
        
        const eventModule = require(filePath);
        const event = eventModule.default || eventModule;

        if (event.config && event.onStart) {
          this.eventHandler.registerEvent(event);
          Logger.success('EVENT', `Loaded: ${event.config.name}`);
        }
      } catch (error) {
        Logger.error('EVENT', `Failed to load ${file}`, error);
      }
    }
  }

  private validateCommand(command: Command): boolean {
    if (!command.config) {
      Logger.error('COMMAND', 'Command missing config');
      return false;
    }

    const { name, description, category } = command.config;
    if (!name || !description || !category) {
      Logger.error('COMMAND', 'Command missing required config fields');
      return false;
    }

    if (typeof command.onStart !== 'function') {
      Logger.error('COMMAND', 'Command missing onStart function');
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
      
      if (event.config && event.onStart) {
        this.eventHandler.registerEvent(event);
        Logger.success('AUTO_RELOAD', `Event ${event.config.name} reloaded`);
      }
    }
  }

  async restart(): Promise<void> {
    Logger.info('RESTART', 'Restarting bot...');
    
    if (this.listening) {
      this.api.stopListening();
      this.listening = null;
    }

    process.exit(2);
  }

  getAPI(): any {
    return this.api;
  }

  getBotID(): string | null {
    return this.botID;
  }

  getCommandManager(): CommandManager {
    return this.commandManager;
  }

  getDatabase(): DatabaseManager {
    return this.database;
  }

  getConfig(): BotConfig {
    return this.config;
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }
}