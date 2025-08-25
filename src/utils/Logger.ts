import chalk from 'chalk';
import moment from 'moment-timezone';

export class Logger {
  private static getTime(): string {
    return chalk.gray(moment().tz('Asia/Ho_Chi_Minh').format('HH:mm:ss DD/MM/YYYY'));
  }

  static info(prefix: string, message: string, ...args: any[]): void {
    console.log(`${this.getTime()} ${chalk.cyan(`[${prefix}]`)} ${message}`, ...args);
  }

  static success(prefix: string, message: string, ...args: any[]): void {
    console.log(`${this.getTime()} ${chalk.green(`[${prefix}]`)} ${message}`, ...args);
  }

  static warn(prefix: string, message: string, ...args: any[]): void {
    console.log(`${this.getTime()} ${chalk.yellow(`[${prefix}]`)} ${message}`, ...args);
  }

  static error(prefix: string, message: string, error?: any): void {
    console.log(`${this.getTime()} ${chalk.red(`[${prefix}]`)} ${message}`);
    if (error) {
      if (error.stack) {
        console.log(chalk.red(error.stack));
      } else if (typeof error === 'object') {
        console.log(chalk.red(JSON.stringify(error, null, 2)));
      } else {
        console.log(chalk.red(String(error)));
      }
    }
  }

  static debug(prefix: string, message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${this.getTime()} ${chalk.magenta(`[${prefix}]`)} ${message}`, ...args);
    }
  }

  static command(commandName: string, userName: string, userID: string, threadID: string, args: string[]): void {
    const argsStr = args.length > 0 ? args.join(' ') : 'no args';
    this.info('COMMAND', `${chalk.cyan(commandName)} | ${chalk.yellow(userName)} | ${chalk.blue(userID)} | ${chalk.green(threadID)} | ${argsStr}`);
  }

  static event(eventType: string, threadID: string, userID?: string): void {
    this.info('EVENT', `${chalk.cyan(eventType)} | ${chalk.green(threadID)}${userID ? ` | ${chalk.blue(userID)}` : ''}`);
  }

  static banner(): void {
    const banner = `
╔══════════════════════════════════════════════════════════════╗
║                        🪐 URANUS BOT 🪐                       ║
║                  Modern TypeScript Chatbot                  ║
║                     Version 2.0.0                          ║
╚══════════════════════════════════════════════════════════════╝
    `;
    
    console.log(chalk.cyan(banner));
  }
}