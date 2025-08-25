import { MessageObject, Event } from '../types/interfaces';
import { Logger } from './Logger';

export class MessageFactory {
  static create(api: any, event: Event): MessageObject {
    return {
      send: async (content: any) => {
        try {
          return await api.sendMessage(content, event.threadID);
        } catch (error) {
          Logger.error('MESSAGE', 'Failed to send message', error);
          throw error;
        }
      },

      reply: async (content: any) => {
        try {
          return await api.sendMessage(content, event.threadID, event.messageID);
        } catch (error) {
          Logger.error('MESSAGE', 'Failed to reply to message', error);
          throw error;
        }
      },

      react: async (emoji: string, messageID?: string) => {
        try {
          const targetMessageID = messageID || event.messageID;
          if (!targetMessageID) {
            throw new Error('No message ID provided for reaction');
          }
          return await api.setMessageReaction(emoji, targetMessageID, true);
        } catch (error) {
          Logger.error('MESSAGE', 'Failed to react to message', error);
          throw error;
        }
      },

      unsend: async (messageID: string) => {
        try {
          return await api.unsendMessage(messageID);
        } catch (error) {
          Logger.error('MESSAGE', 'Failed to unsend message', error);
          throw error;
        }
      }
    };
  }

  static createAttachment(type: 'photo' | 'video' | 'audio' | 'file', url: string): any {
    return {
      type,
      url,
      filename: url.split('/').pop() || 'file'
    };
  }

  static createQuickReply(title: string, payload: string, imageUrl?: string): any {
    return {
      content_type: 'text',
      title,
      payload,
      image_url: imageUrl
    };
  }

  static formatRichMessage(text: string, attachments?: any[], quickReplies?: any[]): any {
    const message: any = { body: text };
    
    if (attachments && attachments.length > 0) {
      message.attachment = attachments;
    }
    
    if (quickReplies && quickReplies.length > 0) {
      message.quick_replies = quickReplies;
    }
    
    return message;
  }

  static createTypingIndicator(api: any, threadID: string, duration: number = 3000): () => void {
    let isTyping = true;
    
    const startTyping = () => {
      if (!isTyping) return;
      api.sendTypingIndicator(threadID, () => {
        setTimeout(startTyping, 1000);
      });
    };

    startTyping();

    setTimeout(() => {
      isTyping = false;
    }, duration);

    return () => {
      isTyping = false;
    };
  }

  static async sendWithDelay(
    api: any,
    messages: any[],
    threadID: string,
    delay: number = 1000
  ): Promise<any[]> {
    const results = [];
    
    for (let i = 0; i < messages.length; i++) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      try {
        const result = await api.sendMessage(messages[i], threadID);
        results.push(result);
      } catch (error) {
        Logger.error('MESSAGE', `Failed to send message ${i + 1}`, error);
        results.push(null);
      }
    }
    
    return results;
  }

  static splitLongMessage(text: string, maxLength: number = 2000): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks = [];
    let currentChunk = '';

    const lines = text.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        // If single line is too long, split by words
        if (line.length > maxLength) {
          const words = line.split(' ');
          for (const word of words) {
            if ((currentChunk + word + ' ').length > maxLength) {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
              }
            }
            currentChunk += word + ' ';
          }
        } else {
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  static createProgressBar(current: number, total: number, width: number = 20): string {
    const percentage = Math.min(current / total, 1);
    const filled = Math.floor(percentage * width);
    const empty = width - filled;
    
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.floor(percentage * 100)}%`;
  }

  static async getUserInfo(api: any, userID: string): Promise<any> {
    try {
      const userInfo = await api.getUserInfo(userID);
      return userInfo[userID];
    } catch (error) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  static async getThreadInfo(api: any, threadID: string): Promise<any> {
    try {
      return await api.getThreadInfo(threadID);
    } catch (error) {
      throw new Error(`Failed to get thread info: ${error.message}`);
    }
  }

  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static validatePhoneNumber(phone: string): boolean {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  }

  static async shortenURL(url: string): Promise<string> {
    try {
      const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
      return response.data;
    } catch (error) {
      return url; // Return original URL if shortening fails
    }
  }

  static getFileExtension(filename: string): string {
    return path.extname(filename).toLowerCase().slice(1);
  }

  static isImage(filename: string): boolean {
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    return imageExts.includes(this.getFileExtension(filename));
  }

  static isVideo(filename: string): boolean {
    const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
    return videoExts.includes(this.getFileExtension(filename));
  }

  static isAudio(filename: string): boolean {
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
    return audioExts.includes(this.getFileExtension(filename));
  }

  static async ensureDir(dirPath: string): Promise<void> {
    await fs.ensureDir(dirPath);
  }

  static async fileExists(filePath: string): Promise<boolean> {
    return await fs.pathExists(filePath);
  }

  static async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  static formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  static cleanupTempFiles(directory: string, maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    return new Promise(async (resolve) => {
      try {
        if (!await fs.pathExists(directory)) {
          resolve();
          return;
        }

        const files = await fs.readdir(directory);
        const now = Date.now();

        for (const file of files) {
          const filePath = path.join(directory, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.remove(filePath);
          }
        }
      } catch (error) {
        Logger.error('CLEANUP', 'Failed to cleanup temp files', error);
      }
      resolve();
    });
  }
}