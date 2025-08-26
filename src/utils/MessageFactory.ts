import { MessageObject, Event } from '../types/interfaces';
import { Logger } from './Logger';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';

/**
 * MessageFactory - Comprehensive messaging utilities for Uranus Bot
 * Handles all message creation, formatting, and utility functions
 */
export class MessageFactory {
  private static readonly MAX_MESSAGE_LENGTH = 2000;
  private static readonly TEMP_DIR = path.join(process.cwd(), 'temp');
  private static readonly ATTACHMENT_CACHE = new Map<string, any>();

  /**
   * Creates a MessageObject with enhanced functionality
   */
  static create(api: any, event: Event): MessageObject {
    return {
      send: async (content: any) => {
        try {
          // Handle different content types
          const processedContent = this.processMessageContent(content);

          // Split long messages if needed
          if (typeof processedContent === 'string' && processedContent.length > this.MAX_MESSAGE_LENGTH) {
            const chunks = this.splitLongMessage(processedContent);
            const results = await this.sendWithDelay(api, chunks, event.threadID, 1000);
            return results[results.length - 1]; // Return last message info
          }

          return await api.sendMessage(processedContent, event.threadID);
        } catch (error: any) {
          Logger.error('MESSAGE', 'Failed to send message', error);
          throw error;
        }
      },

      reply: async (content: any) => {
        try {
          const processedContent = this.processMessageContent(content);

          if (typeof processedContent === 'string' && processedContent.length > this.MAX_MESSAGE_LENGTH) {
            const chunks = this.splitLongMessage(processedContent);
            const results = [];

            // First message as reply, others as regular messages
            results.push(await api.sendMessage(chunks[0], event.threadID, event.messageID));

            for (let i = 1; i < chunks.length; i++) {
              await this.sleep(1000);
              results.push(await api.sendMessage(chunks[i], event.threadID));
            }

            return results[results.length - 1];
          }

          return await api.sendMessage(processedContent, event.threadID, event.messageID);
        } catch (error: any) {
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

          // Validate emoji
          if (!this.isValidEmoji(emoji)) {
            Logger.warn('MESSAGE', `Invalid emoji: ${emoji}`);
            return null;
          }

          return await api.setMessageReaction(emoji, targetMessageID, true);
        } catch (error: any) {
          Logger.error('MESSAGE', 'Failed to react to message', error);
          throw error;
        }
      },

      unsend: async (messageID: string) => {
        try {
          if (!messageID) {
            throw new Error('Message ID is required for unsending');
          }
          return await api.unsendMessage(messageID);
        } catch (error: any) {
          Logger.error('MESSAGE', 'Failed to unsend message', error);
          throw error;
        }
      }
    };
  }

  /**
   * Process message content based on type
   */
  private static processMessageContent(content: any): any {
    if (content === null || content === undefined) {
      return '';
    }

    if (typeof content === 'string') {
      return this.sanitizeMessageText(content);
    }

    if (typeof content === 'object') {
      // Handle attachment objects
      if (content.attachment || content.url || content.path) {
        return this.processAttachment(content);
      }

      // Handle rich message objects
      if (content.body !== undefined) {
        return {
          ...content,
          body: this.sanitizeMessageText(content.body)
        };
      }
    }

    return String(content);
  }

  /**
   * Sanitize message text to prevent issues
   */
  private static sanitizeMessageText(text: string): string {
    if (!text || typeof text !== 'string') return '';

    return text
      .trim()
      .replace(/\x00/g, '') // Remove null bytes
      .replace(/[\uFEFF]/g, '') // Remove BOM
      .substring(0, 20000); // Hard limit to prevent extreme long messages
  }

  /**
   * Create attachment object with validation
   */
  static createAttachment(type: 'photo' | 'video' | 'audio' | 'file', source: string | Buffer | NodeJS.ReadableStream, filename?: string): any {
    const supportedTypes = ['photo', 'video', 'audio', 'file'];

    if (!supportedTypes.includes(type)) {
      throw new Error(`Unsupported attachment type: ${type}`);
    }

    const attachment: any = { type };

    if (typeof source === 'string') {
      if (this.isValidURL(source)) {
        attachment.url = source;
      } else {
        attachment.path = source;
      }
    } else if (Buffer.isBuffer(source)) {
      attachment.buffer = source;
    } else {
      attachment.stream = source;
    }

    if (filename) {
      attachment.filename = this.sanitizeFilename(filename);
    }

    return attachment;
  }

  /**
   * Create quick reply button
   */
  static createQuickReply(title: string, payload: string, imageUrl?: string): any {
    if (!title || !payload) {
      throw new Error('Title and payload are required for quick reply');
    }

    const quickReply: any = {
      content_type: 'text',
      title: title.substring(0, 20), // Facebook limit
      payload: payload.substring(0, 1000)
    };

    if (imageUrl && this.isValidURL(imageUrl)) {
      quickReply.image_url = imageUrl;
    }

    return quickReply;
  }

  /**
   * Format rich message with attachments and quick replies
   */
  static formatRichMessage(text: string, attachments?: any[], quickReplies?: any[]): any {
    const message: any = {
      body: this.sanitizeMessageText(text)
    };

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      message.attachment = attachments.filter(att => att !== null && att !== undefined);
    }

    if (quickReplies && Array.isArray(quickReplies) && quickReplies.length > 0) {
      message.quick_replies = quickReplies.slice(0, 13); // Facebook limit
    }

    return message;
  }

  /**
   * Enhanced typing indicator with better control
   */
  static createTypingIndicator(api: any, threadID: string, duration: number = 3000): () => void {
    if (!api || !threadID || duration <= 0) {
      return () => { }; // Return no-op function
    }

    let isTyping = true;
    let intervalId: NodeJS.Timeout | null = null;

    const startTyping = () => {
      if (!isTyping) return;

      try {
        api.sendTypingIndicator(threadID, (err: any) => {
          if (err) {
            Logger.warn('MESSAGE', 'Failed to send typing indicator', err);
            isTyping = false;
          }
        });
      } catch (error: any) {
        Logger.warn('MESSAGE', 'Error sending typing indicator', error);
        isTyping = false;
      }
    };

    // Start typing immediately
    startTyping();

    // Continue typing every 2 seconds
    intervalId = setInterval(startTyping, 2000);

    // Stop after duration
    const stopTimeout = setTimeout(() => {
      isTyping = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    }, duration);

    // Return stop function
    return () => {
      isTyping = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (stopTimeout) {
        clearTimeout(stopTimeout);
      }
    };
  }

  /**
   * Send multiple messages with delay
   */
  static async sendWithDelay(
    api: any,
    messages: any[],
    threadID: string,
    delay: number = 1000
  ): Promise<any[]> {
    if (!Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    const results = [];

    for (let i = 0; i < messages.length; i++) {
      if (i > 0 && delay > 0) {
        await this.sleep(delay);
      }

      try {
        const result = await api.sendMessage(messages[i], threadID);
        results.push(result);
        Logger.debug('MESSAGE', `Sent message ${i + 1}/${messages.length}`);
      } catch (error: any) {
        Logger.error('MESSAGE', `Failed to send message ${i + 1}`, error);
        results.push(null);
      }
    }

    return results;
  }

  /**
   * Enhanced message splitting with better formatting
   */
  static splitLongMessage(text: string, maxLength: number = this.MAX_MESSAGE_LENGTH): string[] {
    if (!text || typeof text !== 'string') {
      return [''];
    }

    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let currentChunk = '';

    // Try to split by paragraphs first
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      if ((currentChunk + paragraph + '\n\n').length <= maxLength) {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      } else {
        // Save current chunk if exists
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        // Split long paragraph by sentences
        if (paragraph.length > maxLength) {
          const sentences = paragraph.split(/[.!?]+/);

          for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            if (!trimmedSentence) continue;

            if ((currentChunk + trimmedSentence + '. ').length <= maxLength) {
              currentChunk += (currentChunk ? ' ' : '') + trimmedSentence + '.';
            } else {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
              }

              // If single sentence is still too long, split by words
              if (trimmedSentence.length > maxLength) {
                const words = trimmedSentence.split(' ');
                let wordChunk = '';

                for (const word of words) {
                  if ((wordChunk + word + ' ').length <= maxLength) {
                    wordChunk += (wordChunk ? ' ' : '') + word;
                  } else {
                    if (wordChunk) {
                      chunks.push(wordChunk.trim() + '...');
                      wordChunk = '';
                    }
                    wordChunk = word;
                  }
                }

                if (wordChunk) {
                  currentChunk = wordChunk + '.';
                }
              } else {
                currentChunk = trimmedSentence + '.';
              }
            }
          }
        } else {
          currentChunk = paragraph;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // Add continuation indicators
    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1) {
        if (i === 0) {
          chunks[i] += '\n\n📄 (Continued...)';
        } else if (i === chunks.length - 1) {
          chunks[i] = `📄 (Continued from above)\n\n${chunks[i]}`;
        } else {
          chunks[i] = `📄 (Continued from above)\n\n${chunks[i]}\n\n📄 (Continued...)`;
        }
      }
    }

    return chunks.length > 0 ? chunks : [''];
  }

  /**
   * Create enhanced progress bar
   */
  static createProgressBar(
    current: number,
    total: number,
    width: number = 20,
    style: 'classic' | 'modern' | 'dots' = 'classic'
  ): string {
    const percentage = Math.min(Math.max(current / total, 0), 1);
    const filled = Math.floor(percentage * width);
    const empty = width - filled;

    let bar: string;

    switch (style) {
      case 'modern':
        bar = `[${'▰'.repeat(filled)}${'▱'.repeat(empty)}]`;
        break;
      case 'dots':
        bar = `[${'●'.repeat(filled)}${'○'.repeat(empty)}]`;
        break;
      default:
        bar = `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
    }

    return `${bar} ${Math.floor(percentage * 100)}%`;
  }

  /**
   * Get user info with caching
   */
  static async getUserInfo(api: any, userID: string, useCache: boolean = true): Promise<any> {
    if (!userID) {
      throw new Error('User ID is required');
    }

    const cacheKey = `user_${userID}`;

    if (useCache && this.ATTACHMENT_CACHE.has(cacheKey)) {
      const cached = this.ATTACHMENT_CACHE.get(cacheKey);
      if (Date.now() - cached.timestamp < 300000) { // 5 minutes cache
        return cached.data;
      }
    }

    try {
      const userInfo = await api.getUserInfo(userID);
      const userData = userInfo[userID];

      if (useCache && userData) {
        this.ATTACHMENT_CACHE.set(cacheKey, {
          data: userData,
          timestamp: Date.now()
        });
      }

      return userData;
    } catch (error: any) {
      throw new Error(`Failed to get user info for ${userID}: ${error.message}`);
    }
  }

  /**
   * Get thread info with caching
   */
  static async getThreadInfo(api: any, threadID: string, useCache: boolean = true): Promise<any> {
    if (!threadID) {
      throw new Error('Thread ID is required');
    }

    const cacheKey = `thread_${threadID}`;

    if (useCache && this.ATTACHMENT_CACHE.has(cacheKey)) {
      const cached = this.ATTACHMENT_CACHE.get(cacheKey);
      if (Date.now() - cached.timestamp < 600000) { // 10 minutes cache
        return cached.data;
      }
    }

    try {
      const threadInfo = await api.getThreadInfo(threadID);

      if (useCache && threadInfo) {
        this.ATTACHMENT_CACHE.set(cacheKey, {
          data: threadInfo,
          timestamp: Date.now()
        });
      }

      return threadInfo;
    } catch (error: any) {
      throw new Error(`Failed to get thread info for ${threadID}: ${error.message}`);
    }
  }

  /**
   * Advanced message editing
   */
  static async editMessage(api: any, messageID: string, newContent: any): Promise<any> {
    if (!messageID) {
      throw new Error('Message ID is required for editing');
    }

    try {
      const processedContent = this.processMessageContent(newContent);
      return await api.editMessage(processedContent, messageID);
    } catch (error: any) {
      throw new Error(`Failed to edit message ${messageID}: ${error.message}`);
    }
  }

  /**
   * Batch message operations
   */
  static async sendBatch(api: any, operations: Array<{
    type: 'send' | 'reply';
    content: any;
    threadID: string;
    messageID?: string;
  }>): Promise<any[]> {
    const results = [];

    for (const op of operations) {
      try {
        let result;

        switch (op.type) {
          case 'send':
            result = await api.sendMessage(op.content, op.threadID);
            break;
          case 'reply':
            result = await api.sendMessage(op.content, op.threadID, op.messageID);
            break;
        }

        results.push({ success: true, result });
        await this.sleep(500); // Rate limiting
      } catch (error: any) {
        results.push({ success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Download file with progress tracking
   */
  static async downloadFile(
    url: string,
    outputPath: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    if (!this.isValidURL(url)) {
      throw new Error('Invalid URL provided');
    }

    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 30000
      });

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;

      await fs.ensureDir(path.dirname(outputPath));
      const writer = fs.createWriteStream(outputPath);

      response.data.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length;
        if (onProgress && totalSize > 0) {
          onProgress(downloadedSize / totalSize);
        }
      });

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(outputPath));
        writer.on('error', reject);

        setTimeout(() => {
          reject(new Error('Download timeout'));
        }, 60000);
      });
    } catch (error: any) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Upload file to temporary storage
   */
  static async uploadTemp(buffer: Buffer, filename: string): Promise<string> {
    await fs.ensureDir(this.TEMP_DIR);

    const sanitizedFilename = this.sanitizeFilename(filename);
    const tempPath = path.join(this.TEMP_DIR, `${Date.now()}_${sanitizedFilename}`);

    await fs.writeFile(tempPath, buffer);

    // Auto cleanup after 1 hour
    setTimeout(async () => {
      try {
        await fs.remove(tempPath);
      } catch (error: any) {
        Logger.warn('MESSAGE', `Failed to cleanup temp file: ${tempPath}`);
      }
    }, 3600000);

    return tempPath;
  }

  /**
   * Create mention string
   */
  static createMention(userID: string, displayName?: string): string {
    if (!userID) return '';
    const name = displayName || userID;
    return `@[${userID}:${name}]`;
  }

  /**
   * Parse mentions from text
   */
  static parseMentions(text: string): Array<{ userID: string, displayName: string, fullMatch: string }> {
    if (!text) return [];

    const mentionRegex = /@\[(\d+):([^\]]+)\]/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push({
        userID: match[1],
        displayName: match[2],
        fullMatch: match[0]
      });
    }

    return mentions;
  }

  /**
   * Remove mentions from text
   */
  static removeMentions(text: string): string {
    if (!text) return '';
    return text.replace(/@\[\d+:[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Format file size
   */
  static formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return '0 Bytes';
    if (bytes < 0) return 'Invalid size';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));

    return `${size} ${sizes[i]}`;
  }

  /**
   * Validation utilities
   */
  static validateEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static validatePhoneNumber(phone: string): boolean {
    if (!phone || typeof phone !== 'string') return false;
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  }

  static isValidURL(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  static isValidEmoji(emoji: string): boolean {
    if (!emoji || typeof emoji !== 'string') return false;

    // Basic emoji validation - covers most Unicode emoji ranges
    const emojiRegex = /^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]+$/u;
    return emojiRegex.test(emoji);
  }

  /**
   * File utilities
   */
  static getFileExtension(filename: string): string {
    if (!filename || typeof filename !== 'string') return '';
    return path.extname(filename).toLowerCase().slice(1);
  }

  static isImage(filename: string): boolean {
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
    return imageExts.includes(this.getFileExtension(filename));
  }

  static isVideo(filename: string): boolean {
    const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v', '3gp'];
    return videoExts.includes(this.getFileExtension(filename));
  }

  static isAudio(filename: string): boolean {
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'];
    return audioExts.includes(this.getFileExtension(filename));
  }

  static sanitizeFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') return 'file';
    return filename
      .replace(/[<>:"\/\\|?*\x00-\x1f]/g, '')
      .replace(/^\.+/, '')
      .trim() || 'file';
  }

  /**
   * Cleanup utilities
   */
  static async cleanupTempFiles(maxAge: number = 24 * 60 * 60 * 1000): Promise<number> {
    let cleanedCount = 0;

    try {
      if (!await fs.pathExists(this.TEMP_DIR)) {
        return cleanedCount;
      }

      const files = await fs.readdir(this.TEMP_DIR);
      const now = Date.now();

      for (const file of files) {
        try {
          const filePath = path.join(this.TEMP_DIR, file);
          const stats = await fs.stat(filePath);

          if (now - stats.mtime.getTime() > maxAge) {
            await fs.remove(filePath);
            cleanedCount++;
            Logger.debug('MESSAGE', `Cleaned up temp file: ${file}`);
          }
        } catch (error: any) {
          Logger.warn('MESSAGE', `Failed to process temp file ${file}`, error);
        }
      }
    } catch (error: any) {
      Logger.error('CLEANUP', 'Failed to cleanup temp files', error);
    }

    return cleanedCount;
  }

  static clearCache(): void {
    this.ATTACHMENT_CACHE.clear();
    Logger.debug('MESSAGE', 'Cleared message factory cache');
  }

  /**
   * Utility functions
   */
  static async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static generateID(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  static truncateText(text: string, maxLength: number): string {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static escapeHTML(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static unescapeHTML(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  /**
   * Advanced retry mechanism
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000,
    backoff: boolean = true
  ): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error as Error;

        if (i === maxRetries - 1) break;

        const delay = backoff ? baseDelay * Math.pow(2, i) : baseDelay;
        Logger.debug('MESSAGE', `Retry attempt ${i + 1}/${maxRetries} after ${delay}ms`);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Process attachment based on source type
   */
  private static processAttachment(content: any): any {
    if (content.url && this.isValidURL(content.url)) {
      return { attachment: { type: content.type || 'file', url: content.url } };
    }

    if (content.path && typeof content.path === 'string') {
      return { attachment: { type: content.type || 'file', path: content.path } };
    }

    return content;
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): { size: number; entries: number } {
    return {
      size: this.ATTACHMENT_CACHE.size,
      entries: Array.from(this.ATTACHMENT_CACHE.values()).length
    };
  }

  /**
   * Shutdown cleanup
   */
  static async shutdown(): Promise<void> {
    Logger.info('MESSAGE', 'Shutting down MessageFactory...');

    // Clear cache
    this.clearCache();

    // Cleanup temp files
    const cleaned = await this.cleanupTempFiles(0); // Clean all temp files

    Logger.info('MESSAGE', `MessageFactory shutdown complete. Cleaned ${cleaned} temp files.`);
  }
}