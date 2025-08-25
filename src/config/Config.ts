import fs from 'fs-extra';
import path from 'path';
import { BotConfig } from '../types/interfaces';
import { Logger } from '../utils/Logger';

export class Config {
  private static instance: Config;
  private config: BotConfig;
  private configPath: string;

  constructor() {
    this.configPath = path.join(process.cwd(), 'config.json');
    this.config = this.getDefaultConfig();
  }

  static async load(): Promise<Config> {
    if (!Config.instance) {
      Config.instance = new Config();
      await Config.instance.loadConfig();
    }
    return Config.instance;
  }

  private getDefaultConfig(): BotConfig {
    return {
      prefix: '!',
      adminBot: [],
      language: 'en',
      database: {
        type: 'sqlite',
        path: './data/database.sqlite',
        autoSync: false
      },
      facebook: {
        userAgent: 'Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36',
        options: {
          forceLogin: true,
          listenEvents: true,
          logLevel: 'error',
          selfListen: false
        }
      },
      features: {
        autoRestart: false,
        antiInbox: false,
        dashboard: false,
        autoLoadScripts: true
      }
    };
  }

  private async loadConfig(): Promise<void> {
    try {
      if (await fs.pathExists(this.configPath)) {
        const fileContent = await fs.readJson(this.configPath);
        this.config = { ...this.getDefaultConfig(), ...fileContent };
        Logger.info('CONFIG', 'Configuration loaded successfully');
      } else {
        await this.saveConfig();
        Logger.info('CONFIG', 'Default configuration created');
      }
    } catch (error) {
      Logger.error('CONFIG', 'Failed to load configuration', error);
      throw error;
    }
  }

  async saveConfig(): Promise<void> {
    try {
      await fs.writeJson(this.configPath, this.config, { spaces: 2 });
      Logger.info('CONFIG', 'Configuration saved');
    } catch (error) {
      Logger.error('CONFIG', 'Failed to save configuration', error);
      throw error;
    }
  }

  get<K extends keyof BotConfig>(key: K): BotConfig[K] {
    return this.config[key];
  }

  set<K extends keyof BotConfig>(key: K, value: BotConfig[K]): void {
    this.config[key] = value;
  }

  getAll(): BotConfig {
    return { ...this.config };
  }

  async update<K extends keyof BotConfig>(key: K, value: BotConfig[K]): Promise<void> {
    this.config[key] = value;
    await this.saveConfig();
  }

  async updatePath(path: string, value: any): Promise<void> {
    const keys = path.split('.');
    let current: any = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
    await this.saveConfig();
  }

  getPath(path: string, defaultValue?: any): any {
    const keys = path.split('.');
    let current: any = this.config;
    
    for (const key of keys) {
      if (current[key] === undefined) {
        return defaultValue;
      }
      current = current[key];
    }
    
    return current;
  }
}