/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import fs from "node:fs";
import {
  Sequelize,
  Model,
  DataTypes,
  Transaction,
  Optional,
} from "sequelize";

import { Logger } from "../../utils/Logger";
import { DatabaseManager, UserData, ThreadData } from "../../types/interfaces";
import {
  BaseUserDatabase,
  BaseThreadDatabase,
  BaseGlobalDatabase,
} from "../base/BaseDatabases";

/* =========================
 *  Utilities: Keyed Lock + Busy Retry
 * ========================= */
class AsyncKeyLock {
  private locks = new Map<string, Promise<void>>();
  async with<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let release!: () => void;
    const cur = new Promise<void>((r) => (release = r));
    this.locks.set(key, prev.then(() => cur));
    await prev;
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(key) === cur) this.locks.delete(key);
    }
  }
}
function isBusyErr(e: any) {
  const msg = String(e?.message || e);
  return /SQLITE_BUSY|SQLITE_LOCKED/i.test(msg);
}
async function withBusyRetry<T>(
  fn: () => Promise<T>,
  attempts = 5,
  baseDelayMs = 120
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isBusyErr(e) || i === attempts - 1) throw e;
      lastErr = e;
      const delay = baseDelayMs * (i + 1) + Math.floor(Math.random() * 50);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* =========================
 *  Sequelize Models
 * ========================= */
type UserCreation = Optional<
  UserData,
  "exp" | "money" | "banned" | "settings" | "data"
>;
class UserModel extends Model<UserData, UserCreation> implements UserData {
  public userID!: string;
  public name!: string;
  public exp!: number;
  public money!: number;
  public banned!: Record<string, any>;
  public settings!: Record<string, any>;
  public data!: Record<string, any>;
}

type ThreadCreation = Optional<
  ThreadData,
  | "threadName"
  | "adminIDs"
  | "members"
  | "banned"
  | "settings"
  | "data"
  | "isGroup"
  | "isActive"
>;
class ThreadModel
  extends Model<ThreadData, ThreadCreation>
  implements ThreadData {
  public threadID!: string;
  public threadName!: string;
  public adminIDs!: string[];
  public members!: any[];
  public banned!: Record<string, any>;
  public settings!: Record<string, any>;
  public data!: Record<string, any>;
  public isGroup!: boolean;
  public isActive!: boolean;
}

class GlobalModel extends Model {
  public key!: string;
  public data!: any;
}

/* =========================
 *  Concrete DB Classes
 * ========================= */

class SQLiteUserDatabase extends BaseUserDatabase {
  private cache = new Set<string>();
  constructor(
    private sequelize: Sequelize,
    private model: typeof UserModel,
    private lock: AsyncKeyLock
  ) {
    super();
  }

  async warmCache(): Promise<void> {
    const ids = await this.model.findAll({ attributes: ["userID"], raw: true });
    for (const r of ids) this.cache.add(String((r as any).userID));
  }
  existsSync(userID: string): boolean {
    return this.cache.has(String(userID));
  }

  async create(userID: string, userInfo?: any): Promise<UserData> {
    return this.lock.with(`user:${userID}`, async () => {
      return withBusyRetry(async () => {
        return this.sequelize.transaction(
          { type: Transaction.TYPES.IMMEDIATE },
          async (t) => {
            const defaults: UserData = {
              userID,
              name: userInfo?.name || `User${userID}`,
              exp: 0,
              money: 0,
              banned: {},
              settings: {},
              data: {},
            };
            const [row] = await this.model.findOrCreate({
              where: { userID },
              defaults,
              transaction: t,
            });
            this.cache.add(String(userID));
            return row.get({ plain: true }) as UserData;
          }
        );
      });
    });
  }

  async get(userID: string, path?: string, defaultValue?: any): Promise<any> {
    const row = await this.model.findByPk(userID, { raw: true });
    if (!row) return defaultValue ?? null;
    if (!path) return row as UserData;
    const parts = path.split(".");
    let cur: any = row;
    for (const p of parts) {
      cur = cur?.[p];
      if (cur === undefined) return defaultValue ?? null;
    }
    return cur;
  }

  async set(userID: string, data: any, path?: string): Promise<UserData> {
    return this.lock.with(`user:${userID}`, async () => {
      return withBusyRetry(async () => {
        return this.sequelize.transaction(
          { type: Transaction.TYPES.IMMEDIATE },
          async (t) => {
            const row = await this.model.findByPk(userID, { transaction: t });
            if (!row) {
              await this.create(userID);
              return (await this.model.findByPk(userID, { transaction: t }))!.get(
                { plain: true }
              ) as UserData;
            }
            if (!path) {
              await row.update(data, { transaction: t });
            } else {
              const obj = row.get() as any;
              const parts = path.split(".");
              let cur = obj as any;
              for (let i = 0; i < parts.length - 1; i++) {
                const k = parts[i];
                if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
                cur = cur[k];
              }
              cur[parts[parts.length - 1]] = data;
              await row.update(obj, { transaction: t });
            }
            this.cache.add(String(userID));
            return row.get({ plain: true }) as UserData;
          }
        );
      });
    });
  }

  // Fix: Add missing methods
  async addMoney(userID: string, amount: number): Promise<UserData> {
    this.validateUserID(userID);
    this.validateAmount(amount);
    
    return this.lock.with(`user:${userID}`, async () => {
      return withBusyRetry(async () => {
        return this.sequelize.transaction(
          { type: Transaction.TYPES.IMMEDIATE },
          async (t) => {
            let row = await this.model.findByPk(userID, { transaction: t });
            if (!row) {
              row = (await this.model.create({
                userID,
                name: `User${userID}`,
                exp: 0,
                money: amount,
                banned: {},
                settings: {},
                data: {},
              }, { transaction: t }));
            } else {
              const currentMoney = (row.get('money') as number) || 0;
              await row.update({ money: currentMoney + amount }, { transaction: t });
            }
            this.cache.add(String(userID));
            return row.get({ plain: true }) as UserData;
          }
        );
      });
    });
  }

  async addExp(userID: string, amount: number): Promise<UserData> {
    this.validateUserID(userID);
    this.validateAmount(amount);
    
    return this.lock.with(`user:${userID}`, async () => {
      return withBusyRetry(async () => {
        return this.sequelize.transaction(
          { type: Transaction.TYPES.IMMEDIATE },
          async (t) => {
            let row = await this.model.findByPk(userID, { transaction: t });
            if (!row) {
              row = (await this.model.create({
                userID,
                name: `User${userID}`,
                exp: amount,
                money: 0,
                banned: {},
                settings: {},
                data: {},
              }, { transaction: t }));
            } else {
              const currentExp = (row.get('exp') as number) || 0;
              await row.update({ exp: currentExp + amount }, { transaction: t });
            }
            this.cache.add(String(userID));
            return row.get({ plain: true }) as UserData;
          }
        );
      });
    });
  }

  async getName(userID: string): Promise<string> {
    this.validateUserID(userID);
    const row = await this.model.findByPk(userID, { raw: true });
    return row ? (row as UserData).name : `User${userID}`;
  }

  async getAll(): Promise<UserData[]> {
    const rows = await this.model.findAll({ raw: true });
    return rows as unknown as UserData[];
  }

  async remove(userID: string): Promise<boolean> {
    const deleted = await this.model.destroy({ where: { userID } });
    if (deleted > 0) this.cache.delete(String(userID));
    return deleted > 0;
  }
}

class SQLiteThreadDatabase extends BaseThreadDatabase {
  private cache = new Set<string>();
  constructor(
    private sequelize: Sequelize,
    private model: typeof ThreadModel,
    private lock: AsyncKeyLock
  ) {
    super();
  }

  async warmCache(): Promise<void> {
    const ids = await this.model.findAll({ attributes: ["threadID"], raw: true });
    for (const r of ids) this.cache.add(String((r as any).threadID));
  }
  existsSync(threadID: string): boolean {
    return this.cache.has(String(threadID));
  }

  async create(threadID: string, threadInfo?: any): Promise<ThreadData> {
    return this.lock.with(`thread:${threadID}`, async () => {
      return withBusyRetry(async () => {
        return this.sequelize.transaction(
          { type: Transaction.TYPES.IMMEDIATE },
          async (t) => {
            const defaults: ThreadData = {
              threadID,
              threadName: threadInfo?.threadName || `Thread${threadID}`,
              adminIDs: threadInfo?.adminIDs || [],
              members: threadInfo?.members || [],
              banned: {},
              settings: {
                sendWelcomeMessage: true,
                sendLeaveMessage: true,
                customCommand: true,
              },
              data: {},
              isGroup: threadInfo?.isGroup !== false,
              isActive: false,
            };
            const [row] = await this.model.findOrCreate({
              where: { threadID },
              defaults,
              transaction: t,
            });
            this.cache.add(String(threadID));
            return row.get({ plain: true }) as ThreadData;
          }
        );
      });
    });
  }

  async get(threadID: string, path?: string, defaultValue?: any): Promise<any> {
    const row = await this.model.findByPk(threadID, { raw: true });
    if (!row) return defaultValue ?? null;
    if (!path) return row as ThreadData;
    const parts = path.split(".");
    let cur: any = row;
    for (const p of parts) {
      cur = cur?.[p];
      if (cur === undefined) return defaultValue ?? null;
    }
    return cur;
  }

  async set(threadID: string, data: any, path?: string): Promise<ThreadData> {
    return this.lock.with(`thread:${threadID}`, async () => {
      return withBusyRetry(async () => {
        return this.sequelize.transaction(
          { type: Transaction.TYPES.IMMEDIATE },
          async (t) => {
            const row = await this.model.findByPk(threadID, { transaction: t });
            if (!row) {
              await this.create(threadID);
              return (await this.model.findByPk(threadID, { transaction: t }))!.get(
                { plain: true }
              ) as ThreadData;
            }
            if (!path) {
              await row.update(data, { transaction: t });
            } else {
              const obj = row.get() as any;
              const parts = path.split(".");
              let cur = obj as any;
              for (let i = 0; i < parts.length - 1; i++) {
                const k = parts[i];
                if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
                cur = cur[k];
              }
              cur[parts[parts.length - 1]] = data;
              await row.update(obj, { transaction: t });
            }
            this.cache.add(String(threadID));
            return row.get({ plain: true }) as ThreadData;
          }
        );
      });
    });
  }

  async refreshInfo(threadID: string): Promise<ThreadData> {
    const row = await this.model.findByPk(threadID, { raw: true });
    if (!row) throw new Error(`Thread ${threadID} not found`);
    return row as ThreadData;
  }

  async getAll(): Promise<ThreadData[]> {
    const rows = await this.model.findAll({ raw: true });
    return rows as unknown as ThreadData[];
  }

  async remove(threadID: string): Promise<boolean> {
    const deleted = await this.model.destroy({ where: { threadID } });
    if (deleted > 0) this.cache.delete(String(threadID));
    return deleted > 0;
  }
}

class SQLiteGlobalDatabase extends BaseGlobalDatabase {
  constructor(
    private sequelize: Sequelize,
    private model: typeof GlobalModel
  ) {
    super();
  }

  async get(key: string, defaultValue?: any): Promise<any> {
    const row = await this.model.findByPk(key, { raw: true });
    if (!row) return defaultValue ?? null;
    return (row as any).data ?? defaultValue ?? null;
  }

  async set(key: string, data: any): Promise<any> {
    await withBusyRetry(async () => {
      await this.sequelize.transaction(
        { type: Transaction.TYPES.IMMEDIATE },
        async (t) => {
          const [row] = await this.model.findOrCreate({
            where: { key },
            defaults: { key, data },
            transaction: t,
          });
          await row.update({ data }, { transaction: t });
        }
      );
    });
    return data;
  }

  async getAll(): Promise<Record<string, any>> {
    const rows = await this.model.findAll({ raw: true });
    const out: Record<string, any> = {};
    for (const r of rows) out[(r as any).key] = (r as any).data;
    return out;
  }

  async remove(key: string): Promise<boolean> {
    const deleted = await this.model.destroy({ where: { key } });
    return deleted > 0;
  }
}

/* =========================
 *  SQLiteDatabase (manager)
 * ========================= */

type SQLiteInit =
  | string
  | { storage?: string; sequelize?: Sequelize };

export class SQLiteDatabase implements DatabaseManager {
  public sequelize!: Sequelize;

  private userModel!: typeof UserModel;
  private threadModel!: typeof ThreadModel;
  private globalModel!: typeof GlobalModel;

  public users!: SQLiteUserDatabase;
  public threads!: SQLiteThreadDatabase;
  public global!: SQLiteGlobalDatabase;

  private lock = new AsyncKeyLock();

  // accept either storage path (string) OR an existing Sequelize instance
  private storagePath?: string;
  private externalSequelize?: Sequelize;

  constructor(init?: SQLiteInit) {
    if (typeof init === "string") {
      this.storagePath = init;
    } else if (init && "sequelize" in init && init.sequelize) {
      this.externalSequelize = init.sequelize;
    } else if (init && "storage" in init && init.storage) {
      this.storagePath = init.storage!;
    } else {
      this.storagePath = path.join(process.cwd(), "data", "app.sqlite");
    }
  }

  async initialize(): Promise<void> {
    // If caller passed a Sequelize, use it. Otherwise, create our own (sqlite file).
    if (this.externalSequelize) {
      this.sequelize = this.externalSequelize;
    } else {
      const storage = this.storagePath!;
      const dir = path.dirname(storage);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      this.sequelize = new Sequelize({
        dialect: "sqlite",
        storage,
        logging: false,
        pool: { max: 1, min: 0, idle: 10_000, acquire: 60_000 },
        retry: { match: [/SQLITE_BUSY/i, /SQLITE_LOCKED/i], max: 3 },
      });
    }

    await this.sequelize.authenticate();

    // Only run PRAGMAs for sqlite
    if (this.sequelize.getDialect() === "sqlite") {
      await this.sequelize.query("PRAGMA journal_mode = WAL;");
      await this.sequelize.query("PRAGMA synchronous = NORMAL;");
      await this.sequelize.query("PRAGMA busy_timeout = 8000;");
      await this.sequelize.query("PRAGMA foreign_keys = ON;");
    }

    // Init models
    this.userModel = UserModel.init(
      {
        userID: { type: DataTypes.STRING, primaryKey: true },
        name: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
        exp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        money: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        banned: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
        settings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
        data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      },
      { sequelize: this.sequelize, tableName: "Users", indexes: [{ unique: true, fields: ["userID"] }] }
    );

    this.threadModel = ThreadModel.init(
      {
        threadID: { type: DataTypes.STRING, primaryKey: true },
        threadName: { type: DataTypes.STRING, allowNull: false, defaultValue: "" },
        adminIDs: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
        members: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
        banned: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
        settings: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: {
            sendWelcomeMessage: true,
            sendLeaveMessage: true,
            customCommand: true,
          },
        },
        data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
        isGroup: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      },
      { sequelize: this.sequelize, tableName: "Threads", indexes: [{ unique: true, fields: ["threadID"] }] }
    );

    this.globalModel = GlobalModel.init(
      {
        key: { type: DataTypes.STRING, primaryKey: true },
        data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      },
      { sequelize: this.sequelize, tableName: "Global" }
    );

    await this.sequelize.sync();

    // Handlers
    this.users = new SQLiteUserDatabase(this.sequelize, this.userModel, this.lock);
    this.threads = new SQLiteThreadDatabase(this.sequelize, this.threadModel, this.lock);
    this.global = new SQLiteGlobalDatabase(this.sequelize, this.globalModel);

    // Warm caches
    await this.users.warmCache();
    await this.threads.warmCache();

    Logger.info('[DB] ',
      `SQLite initialized ${this.storagePath ? `at ${this.storagePath}` : `(external sequelize)`
      }`
    );
  }
}