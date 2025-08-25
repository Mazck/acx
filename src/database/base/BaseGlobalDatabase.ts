import { GlobalDatabase } from '../../types/interfaces';
import _ from 'lodash';

export abstract class BaseGlobalDatabase implements GlobalDatabase {
  abstract get(key: string, path?: string, defaultValue?: any): Promise<any>;
  abstract set(key: string, data: any, path?: string): Promise<any>;
  abstract remove(key: string): Promise<boolean>;

  protected getNestedValue(obj: any, path: string, defaultValue?: any): any {
    return _.get(obj, path, defaultValue);
  }

  protected setNestedValue(obj: any, path: string, value: any): void {
    _.set(obj, path, value);
  }

  protected validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('Invalid key: must be a non-empty string');
    }
  }

  async getAll(): Promise<Record<string, any>> {
    // Default implementation - can be overridden
    throw new Error('getAll method not implemented');
  }

  async exists(key: string): Promise<boolean> {
    try {
      const value = await this.get(key);
      return value !== undefined;
    } catch {
      return false;
    }
  }

  async increment(key: string, path?: string, amount: number = 1): Promise<number> {
    const currentValue = await this.get(key, path, 0);
    const newValue = (currentValue || 0) + amount;
    await this.set(key, newValue, path);
    return newValue;
  }

  async decrement(key: string, path?: string, amount: number = 1): Promise<number> {
    return this.increment(key, path, -amount);
  }
}