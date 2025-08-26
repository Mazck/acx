import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import moment from 'moment-timezone';

export class Utils {
  static formatNumber(number: number): string {
    return number.toLocaleString('en-US');
  }

  static formatTime(timestamp: number, format: string = 'DD/MM/YYYY HH:mm:ss'): string {
    return moment(timestamp).tz('Asia/Ho_Chi_Minh').format(format);
  }

  static convertDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);

    return parts.join(' ') || '0s';
  }

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

  static randomString(length: number = 10): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static randomNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[len2][len1];
  }

  static async downloadFile(url: string, outputPath: string): Promise<string> {
    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream'
      });

      await fs.ensureDir(path.dirname(outputPath));
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(outputPath));
        writer.on('error', reject);
      });
    } catch (error: any) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  static async getStreamFromURL(url: string, filename?: string): Promise<NodeJS.ReadableStream> {
    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream'
      });

      if (filename) {
        (response.data as any).path = filename;
      }

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get stream from URL: ${error.message}`);
    }
  }

  static isValidURL(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  static sanitizeString(str: string): string {
    return str.replace(/[<>:"\/\\|?*]/g, '').trim();
  }

  static truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static async findFacebookUID(profileUrl: string): Promise<string | null> {
    try {
      const response = await axios.get(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const uidMatch = response.data.match(/"userID":"(\d+)"/);
      if (uidMatch) {
        return uidMatch[1];
      }

      const profileMatch = response.data.match(/profile_id=(\d+)/);
      if (profileMatch) {
        return profileMatch[1];
      }

      return null;
    } catch (error: any) {
      throw new Error(`Failed to find UID: ${error.message}`);
    }
  }

  static chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  static async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (i < maxRetries - 1) {
          await this.sleep(delay * (i + 1));
        }
      }
    }

    throw lastError!;
  }

  static parseArgs(input: string): string[] {
    const args = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }

  static escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  static isNumeric(value: any): boolean {
    return !isNaN(parseFloat(value)) && isFinite(value);
  }

  static generateID(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  static async validateJSON(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  }

  static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  static removeHomeDir(fullPath: string): string {
    return fullPath.replace(process.cwd(), '');
  }

  static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  static stripHTML(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-');
  }

  static getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  static shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  static clamp(num: number, min: number, max: number): number {
    return Math.min(Math.max(num, min), max);
  }

  static roundToDecimal(num: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  }

  static percentage(value: number, total: number): number {
    return total === 0 ? 0 : (value / total) * 100;
  }

  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }

  static parseSize(sizeStr: string): number {
    const units: Record<string, number> = {
      'b': 1,
      'kb': 1024,
      'mb': 1024 ** 2,
      'gb': 1024 ** 3,
      'tb': 1024 ** 4
    };

    const match = sizeStr.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2] || 'b';

    return value * (units[unit] || 1);
  }

  static getTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    if (diff < minute) return 'just now';
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    if (diff < week) return `${Math.floor(diff / day)}d ago`;
    if (diff < month) return `${Math.floor(diff / week)}w ago`;
    if (diff < year) return `${Math.floor(diff / month)}mo ago`;
    return `${Math.floor(diff / year)}y ago`;
  }

  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidPhone(phone: string): boolean {
    const phoneRegex = /^[\+]?[\d\s\-\(\)]{10,15}$/;
    return phoneRegex.test(phone);
  }

  static maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    if (!user || !domain) return email;

    const maskedUser = user.length <= 2
      ? '*'.repeat(user.length)
      : user[0] + '*'.repeat(user.length - 2) + user[user.length - 1];

    return `${maskedUser}@${domain}`;
  }

  static maskPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 4) return phone;

    const start = cleaned.slice(0, 3);
    const end = cleaned.slice(-2);
    const middle = '*'.repeat(cleaned.length - 5);

    return `${start}${middle}${end}`;
  }

  static colorizeText(text: string, color: 'red' | 'green' | 'blue' | 'yellow' | 'magenta' | 'cyan'): string {
    const colors: Record<string, string> = {
      red: '\x1b[31m',
      green: '\x1b[32m',
      blue: '\x1b[34m',
      yellow: '\x1b[33m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m'
    };

    const reset = '\x1b[0m';
    return `${colors[color] || ''}${text}${reset}`;
  }
}