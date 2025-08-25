import { UserDatabase, UserData } from '../../types/interfaces';
import _ from 'lodash';

export abstract class BaseUserDatabase implements UserDatabase {
  abstract create(userID: string, userInfo?: any): Promise<UserData>;
  abstract get(userID: string, path?: string, defaultValue?: any): Promise<any>;
  abstract set(userID: string, data: any, path?: string): Promise<UserData>;
  abstract addMoney(userID: string, amount: number): Promise<UserData>;
  abstract addExp(userID: string, amount: number): Promise<UserData>;
  abstract getName(userID: string): Promise<string>;
  abstract getAll(): Promise<UserData[]>;
  abstract remove(userID: string): Promise<boolean>;
  abstract existsSync(userID: string): boolean;

  protected getNestedValue(obj: any, path: string, defaultValue?: any): any {
    return _.get(obj, path, defaultValue);
  }

  protected setNestedValue(obj: any, path: string, value: any): void {
    _.set(obj, path, value);
  }

  protected validateUserID(userID: string): void {
    if (!userID || typeof userID !== 'string') {
      throw new Error('Invalid userID: must be a non-empty string');
    }
  }

  protected validateAmount(amount: number): void {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('Invalid amount: must be a valid number');
    }
  }
}