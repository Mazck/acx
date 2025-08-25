import fs from 'fs-extra';
import path from 'path';
import { DatabaseManager, UserData, ThreadData } from '../../types/interfaces';
import { BaseUserDatabase, BaseThreadDatabase, BaseGlobalDatabase } from '../base/BaseDatabases';
import { Logger } from '../../utils/Logger';

export class JSONDatabase implements DatabaseManager {
  private dataPath: string;
  public users: JSONUserDatabase;
  public threads: JSONThreadDatabase;
  public global: JSONGlobalDatabase;

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data');
  }

  async initialize(): Promise<void> {
    // Ensure data directory exists
    await fs.ensureDir(this.dataPath);

    // Initialize database handlers
    this.users = new JSONUserDatabase(this.dataPath);
    this.threads = new JSONThreadDatabase(this.dataPath);
    this.global = new JSONGlobalDatabase(this.dataPath);

    await this.users.initialize();
    await this.threads.initialize();
    await this.global.initialize();

    Logger.success('DATABASE', 'JSON database initialized');
  }
}

class JSONUserDatabase extends BaseUserDatabase {
  private filePath: string;
  private users: UserData[] = [];

  constructor(dataPath: string) {
    super();
    this.filePath = path.join(dataPath, 'users.json');
  }

  async initialize(): Promise<void> {
    try {
      if (await fs.pathExists(this.filePath)) {
        this.users = await fs.readJson(this.filePath);
      } else {
        await this.saveData();
      }
    } catch (error) {
      Logger.error('JSON_DB', 'Failed to initialize user database', error);
      this.users = [];
    }
  }

  private async saveData(): Promise<void> {
    await fs.writeJson(this.filePath, this.users, { spaces: 2 });
  }

  async create(userID: string, userInfo?: any): Promise<UserData> {
    const existingUser = this.users.find(u => u.userID === userID);
    if (existingUser) {
      throw new Error(`User ${userID} already exists`);
    }

    const userData: UserData = {
      userID,
      name: userInfo?.name || `User${userID}`,
      exp: 0,
      money: 0,
      banned: {},
      settings: {},
      data: {}
    };

    this.users.push(userData);
    await this.saveData();
    return { ...userData };
  }

  async get(userID: string, path?: string, defaultValue?: any): Promise<any> {
    const user = this.users.find(u => u.userID === userID);
    if (!user) {
      return path ? defaultValue : undefined;
    }

    if (path) {
      return this.getNestedValue(user, path, defaultValue);
    }

    return { ...user };
  }

  async set(userID: string, data: any, path?: string): Promise<UserData> {
    let user = this.users.find(u => u.userID === userID);
    
    if (!user) {
      user = await this.create(userID, data);
    } else {
      if (path) {
        this.setNestedValue(user, path, data);
      } else {
        Object.assign(user, data);
      }
      await this.saveData();
    }

    return { ...user };
  }

  async addMoney(userID: string, amount: number): Promise<UserData> {
    const user = this.users.find(u => u.userID === userID);
    if (!user) throw new Error('User not found');

    user.money = (user.money || 0) + amount;
    await this.saveData();
    return { ...user };
  }

  async addExp(userID: string, amount: number): Promise<UserData> {
    const user = this.users.find(u => u.userID === userID);
    if (!user) throw new Error('User not found');

    user.exp = (user.exp || 0) + amount;
    await this.saveData();
    return { ...user };
  }

  async getName(userID: string): Promise<string> {
    const user = this.users.find(u => u.userID === userID);
    return user?.name || `User${userID}`;
  }

  async getAll(): Promise<UserData[]> {
    return this.users.map(user => ({ ...user }));
  }

  async remove(userID: string): Promise<boolean> {
    const index = this.users.findIndex(u => u.userID === userID);
    if (index === -1) return false;

    this.users.splice(index, 1);
    await this.saveData();
    return true;
  }

  existsSync(userID: string): boolean {
    return this.users.some(u => u.userID === userID);
  }
}

class JSONThreadDatabase extends BaseThreadDatabase {
  private filePath: string;
  private threads: ThreadData[] = [];

  constructor(dataPath: string) {
    super();
    this.filePath = path.join(dataPath, 'threads.json');
  }

  async initialize(): Promise<void> {
    try {
      if (await fs.pathExists(this.filePath)) {
        this.threads = await fs.readJson(this.filePath);
      } else {
        await this.saveData();
      }
    } catch (error) {
      Logger.error('JSON_DB', 'Failed to initialize thread database', error);
      this.threads = [];
    }
  }

  private async saveData(): Promise<void> {
    await fs.writeJson(this.filePath, this.threads, { spaces: 2 });
  }

  async create(threadID: string, threadInfo?: any): Promise<ThreadData> {
    const existingThread = this.threads.find(t => t.threadID === threadID);
    if (existingThread) {
      throw new Error(`Thread ${threadID} already exists`);
    }

    const threadData: ThreadData = {
      threadID,
      threadName: threadInfo?.threadName || `Thread${threadID}`,
      adminIDs: threadInfo?.adminIDs || [],
      members: threadInfo?.members || [],
      banned: {},
      settings: {
        sendWelcomeMessage: true,
        sendLeaveMessage: true,
        customCommand: true
      },
      data: {},
      isGroup: threadInfo?.isGroup || true,
      isActive: false
    };

    this.threads.push(threadData);
    await this.saveData();
    return { ...threadData };
  }

  async get(threadID: string, path?: string, defaultValue?: any): Promise<any> {
    const thread = this.threads.find(t => t.threadID === threadID);
    if (!thread) {
      return path ? defaultValue : undefined;
    }

    if (path) {
      return this.getNestedValue(thread, path, defaultValue);
    }

    return { ...thread };
  }

  async set(threadID: string, data: any, path?: string): Promise<ThreadData> {
    let thread = this.threads.find(t => t.threadID === threadID);
    
    if (!thread) {
      thread = await this.create(threadID, data);
    } else {
      if (path) {
        this.setNestedValue(thread, path, data);
      } else {
        Object.assign(thread, data);
      }
      await this.saveData();
    }

    return { ...thread };
  }

  async refreshInfo(threadID: string): Promise<ThreadData> {
    const thread = await this.get(threadID);
    return thread;
  }

  async getAll(): Promise<ThreadData[]> {
    return this.threads.map(thread => ({ ...thread }));
  }

  async remove(threadID: string): Promise<boolean> {
    const index = this.threads.findIndex(t => t.threadID === threadID);
    if (index === -1) return false;

    this.threads.splice(index, 1);
    await this.saveData();
    return true;
  }

  existsSync(threadID: string): boolean {
    return this.threads.some(t => t.threadID === threadID);
  }
}

class JSONGlobalDatabase extends BaseGlobalDatabase {
  private filePath: string;
  private data: Record<string, any> = {};

  constructor(dataPath: string) {
    super();
    this.filePath = path.join(dataPath, 'global.json');
  }

  async initialize(): Promise<void> {
    try {
      if (await fs.pathExists(this.filePath)) {
        this.data = await fs.readJson(this.filePath);
      } else {
        await this.saveData();
      }
    } catch (error) {
      Logger.error('JSON_DB', 'Failed to initialize global database', error);
      this.data = {};
    }
  }

  private async saveData(): Promise<void> {
    await fs.writeJson(this.filePath, this.data, { spaces: 2 });
  }

  async get(key: string, path?: string, defaultValue?: any): Promise<any> {
    const value = this.data[key];
    if (value === undefined) {
      return defaultValue;
    }

    if (path) {
      return this.getNestedValue(value, path, defaultValue);
    }

    return value;
  }

  async set(key: string, data: any, path?: string): Promise<any> {
    if (path) {
      if (!this.data[key]) {
        this.data[key] = {};
      }
      this.setNestedValue(this.data[key], path, data);
    } else {
      this.data[key] = data;
    }

    await this.saveData();
    return data;
  }

  async remove(key: string): Promise<boolean> {
    if (this.data[key] === undefined) return false;
    
    delete this.data[key];
    await this.saveData();
    return true;
  }
}