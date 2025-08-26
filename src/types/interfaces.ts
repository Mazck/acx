export interface BotConfig {
  prefix: string;
  adminBot: string[];
  language: string;
  database: DatabaseConfig;
  facebook: FacebookConfig;
  payos?: PayOSConfig;
  features: FeatureConfig;
}

export interface DatabaseConfig {
  type: 'sqlite' | 'mongodb' | 'json';
  path?: string;
  uri?: string;
  autoSync: boolean;
}

export interface FacebookConfig {
  email?: string;
  password?: string;
  appState?: string;
  userAgent: string;
  options: any;
}

export interface PayOSConfig {
  enable: boolean;
  clientId: string;
  apiKey: string;
  checksumKey: string;
  webhookUrl?: string;
  packages: Record<string, PackageInfo>;
}

export interface PackageInfo {
  name: string;
  price: number;
  days: number;
  description: string;
}

export interface FeatureConfig {
  autoRestart: boolean;
  antiInbox: boolean;
  dashboard: boolean;
  autoLoadScripts: boolean;
}

export interface CommandConfig {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  category: string;
  role: number;
  cooldown: number;
  version: string;
  author: string;
}

export interface Command {
  config: CommandConfig;
  onStart: CommandHandler;
  onChat?: ChatHandler;
  onReply?: ReplyHandler;
  onReaction?: ReactionHandler;
  onEvent?: EventHandler;
}

export interface Event {
  type: string;
  threadID: string;
  messageID?: string;
  senderID?: string;
  userID?: string;
  body?: string;
  isGroup: boolean;
  messageReply?: any;
  attachments?: any[];
  [key: string]: any;
}

export interface UserData {
  userID: string;
  name: string;
  exp: number;
  money: number;
  banned: BanInfo;
  settings: Record<string, any>;
  data: Record<string, any>;
}

export interface ThreadData {
  threadID: string;
  threadName: string;
  avatarURL: string;
  adminIDs: string[];
  members: Member[];
  nicknames: Record<string, string>;
  banned: BanInfo;
  settings: ThreadSettings;
  data: Record<string, any>;
  isGroup: boolean;
  isActive: boolean;
  inviteLink?: any;
  emoji?: any;
  threadTheme?: any;
}

export interface Member {
  userID: string;
  name: string;
  nickname?: string;
  inGroup: boolean;
  count: number;
}

export interface ThreadSettings {
  sendWelcomeMessage: boolean;
  sendLeaveMessage: boolean;
  customCommand: boolean;
  prefix?: string;
}

export interface BanInfo {
  status?: boolean;
  reason?: string;
  date?: string;
  by?: string;
}

export interface MessageContext {
  api: any;
  event: Event;
  args: string[];
  message: MessageObject;
  userData: UserData;
  threadData: ThreadData;
  prefix: string;
  role: number;
  commandName: string;
}

export interface MessageObject {
  send: (content: any) => Promise<any>;
  reply: (content: any) => Promise<any>;
  react: (emoji: string, messageID?: string) => Promise<any>;
  unsend: (messageID: string) => Promise<any>;
}

export type CommandHandler = (context: MessageContext) => Promise<void>;
export type ChatHandler = (context: MessageContext) => Promise<void | (() => Promise<void>)>;
export type ReplyHandler = (context: MessageContext & { Reply: any }) => Promise<void>;
export type ReactionHandler = (context: MessageContext & { Reaction: any }) => Promise<void>;
export type EventHandler = (context: MessageContext) => Promise<void | (() => Promise<void>)>;

export interface DatabaseManager {
  users: UserDatabase;
  threads: ThreadDatabase;
  global: GlobalDatabase;
}

export interface UserDatabase {
  create(userID: string, userInfo?: any): Promise<UserData>;
  get(userID: string, path?: string, defaultValue?: any): Promise<any>;
  set(userID: string, data: any, path?: string): Promise<UserData>;
  addMoney(userID: string, amount: number): Promise<UserData>;
  addExp(userID: string, amount: number): Promise<UserData>;
  getName(userID: string): Promise<string>;
  getAll(): Promise<UserData[]>;
  remove(userID: string): Promise<boolean>;
}

export interface ThreadDatabase {
  create(threadID: string, threadInfo?: any): Promise<ThreadData>;
  get(threadID: string, path?: string, defaultValue?: any): Promise<any>;
  set(threadID: string, data: any, path?: string): Promise<ThreadData>;
  refreshInfo(threadID: string): Promise<ThreadData>;
  getAll(): Promise<ThreadData[]>;
  remove(threadID: string): Promise<boolean>;
}

export interface GlobalDatabase {
  get(key: string, path?: string, defaultValue?: any): Promise<any>;
  set(key: string, data: any, path?: string): Promise<any>;
  remove(key: string): Promise<boolean>;
}