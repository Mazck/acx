import path from "node:path";
import { Sequelize } from "sequelize";
import { SQLiteDatabase } from "./providers/SQLiteDatabase";
import { Logger } from "../utils/Logger";

type DBKind = "sqlite";
type SQLiteOpts = { storage?: string; sequelize?: Sequelize };
type CreateArg = DBKind | (SQLiteOpts & { kind?: DBKind });

export class DatabaseFactory {
  /**
   * Flexible create:
   * - create("sqlite")
   * - create("sqlite", { storage })
   * - create({ storage })
   * - create({ sequelize })
   * - create({ kind: "sqlite", storage })
   */
  static async create(arg?: CreateArg, opts?: SQLiteOpts) {
    let kind: DBKind = "sqlite";
    let finalOpts: SQLiteOpts = {};

    if (typeof arg === "string") {
      // create("sqlite", { ... })
      kind = arg as DBKind;
      finalOpts = { ...(opts || {}) };
    } else if (arg && typeof arg === "object") {
      // create({ storage }) | create({ sequelize }) | create({ kind, ... })
      if ((arg as any).kind) kind = (arg as any).kind as DBKind;
      finalOpts = {
        storage: (arg as any).storage,
        sequelize: (arg as any).sequelize,
      };
    } else {
      // create() -> default sqlite at data/app.sqlite
      finalOpts = {};
    }

    if (kind !== "sqlite") {
      throw new Error(`Unsupported DB kind: ${String(kind)}`);
    }

    return await this.createSQLiteDatabase(finalOpts);
  }

  static async createSQLiteDatabase(opts?: SQLiteOpts) {
    if (opts?.sequelize && opts?.storage) {
      Logger.warn('[DB] ',
        "Both sequelize and storage provided; using sequelize and ignoring storage."
      );
    }

    const db = opts?.sequelize
      ? new SQLiteDatabase({ sequelize: opts.sequelize })
      : new SQLiteDatabase({
        storage:
          opts?.storage ?? path.join(process.cwd(), "data", "app.sqlite"),
      });

    await db.initialize();
    return db;
  }
}
