import { ThreadDatabase, ThreadData } from '../../types/interfaces';
import _ from 'lodash';

export abstract class BaseThreadDatabase implements ThreadDatabase {
  abstract create(threadID: string, threadInfo?: any): Promise<ThreadData>;
  abstract get(threadID: string, path?: string, defaultValue?: any): Promise<any>;
  abstract set(threadID: string, data: any, path?: string): Promise<ThreadData>;
  abstract refreshInfo(threadID: string): Promise<ThreadData>;
  abstract getAll(): Promise<ThreadData[]>;
  abstract remove(threadID: string): Promise<boolean>;
  abstract existsSync(threadID: string): boolean;

  protected getNestedValue(obj: any, path: string, defaultValue?: any): any {
    return _.get(obj, path, defaultValue);
  }

  protected setNestedValue(obj: any, path: string, value: any): void {
    _.set(obj, path, value);
  }

  protected validateThreadID(threadID: string): void {
    if (!threadID || typeof threadID !== 'string') {
      throw new Error('Invalid threadID: must be a non-empty string');
    }
  }

  protected createDefaultThreadData(threadID: string, threadInfo?: any): ThreadData {
    return {
      threadID,
      threadName: threadInfo?.threadName || `Thread ${threadID}`,
      avatarURL: threadInfo?.imageSrc || "",
      adminIDs: threadInfo?.adminIDs || [],
      members: threadInfo?.members || [],
      nicknames: threadInfo?.nicknames || {},
      banned: {},
      settings: {
        sendWelcomeMessage: true,
        sendLeaveMessage: true,
        customCommand: true
      },
      data: {},
      isGroup: threadInfo?.isGroup !== false,
      isActive: false,
      inviteLink: threadInfo?.inviteLink || null,
      emoji: threadInfo?.emoji || null,
      threadTheme: threadInfo?.threadTheme || null
    };
  }
}