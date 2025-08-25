import { Command, MessageContext } from '../types/interfaces';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';

export class CommandManager {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, string> = new Map();
  private cooldowns: Map<string, Map<string, number>> = new Map();

  register(command: Command): void {
    const { name, aliases } = command.config;
    
    // Check if command already exists
    if (this.commands.has(name.toLowerCase())) {
      Logger.warn('COMMAND', `Command ${name} already exists, overwriting...`);
    }

    // Register main command
    this.commands.set(name.toLowerCase(), command);
    
    // Register aliases
    if (aliases && Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (this.aliases.has(alias.toLowerCase())) {
          Logger.warn('COMMAND', `Alias ${alias} already exists for another command`);
          continue;
        }
        this.aliases.set(alias.toLowerCase(), name.toLowerCase());
      }
    }

    Logger.debug('COMMAND', `Registered command: ${name} with ${aliases?.length || 0} aliases`);
  }

  get(name: string): Command | undefined {
    const commandName = name.toLowerCase();
    return this.commands.get(commandName) || this.commands.get(this.aliases.get(commandName) || '');
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  getAllByCategory(category: string): Command[] {
    return this.getAll().filter(cmd => cmd.config.category.toLowerCase() === category.toLowerCase());
  }

  getCategories(): string[] {
    const categories = new Set<string>();
    for (const command of this.commands.values()) {
      categories.add(command.config.category);
    }
    return Array.from(categories).sort();
  }

  async executeCommand(context: MessageContext): Promise<boolean> {
    const { event, args, userData, threadData } = context;
    const commandName = args[0]?.toLowerCase();
    console.log(commandName)
    if (!commandName) return false;

    const command = this.get(commandName);
    if (!command) return false;

    // Check permissions
    if (!this.checkPermissions(command, context)) {
      return true; // Command exists but no permission
    }

    // Check cooldown
    if (!this.checkCooldown(command, context)) {
      return true; // Command exists but on cooldown
    }

    try {
      // Set cooldown
      this.setCooldown(command.config.name, userData.userID, command.config.cooldown);

      // Execute command
      const newContext = {
        ...context,
        commandName: command.config.name,
        args: args.slice(1)
      };

      await command.onStart(newContext);
      
      Logger.command(
        command.config.name,
        userData.name,
        userData.userID,
        threadData.threadID,
        newContext.args
      );

      return true;
    } catch (error) {
      Logger.error('COMMAND', `Error executing ${command.config.name}`, error);
      await context.message.reply(`❌ An error occurred while executing the command: ${error.message}`);
      return true;
    }
  }

  private checkPermissions(command: Command, context: MessageContext): boolean {
    const { userData, threadData, role } = context;
    const requiredRole = command.config.role || 0;

    if (requiredRole > role) {
      const roleNames = ['Everyone', 'Group Admin', 'Bot Admin'];
      context.message.reply(`❌ You need ${roleNames[requiredRole]} permission to use this command.`);
      return false;
    }

    // Check if user is banned
    if (userData.banned.status) {
      context.message.reply(`❌ You are banned from using commands. Reason: ${userData.banned.reason}`);
      return false;
    }

    // Check if thread is banned (for group chats)
    if (context.event.isGroup && threadData.banned.status) {
      context.message.reply(`❌ This group is banned from using commands. Reason: ${threadData.banned.reason}`);
      return false;
    }

    return true;
  }

  private checkCooldown(command: Command, context: MessageContext): boolean {
    const { userData } = context;
    const commandName = command.config.name;
    const cooldownAmount = (command.config.cooldown || 1) * 1000;

    if (!this.cooldowns.has(commandName)) {
      this.cooldowns.set(commandName, new Map());
    }

    const now = Date.now();
    const timestamps = this.cooldowns.get(commandName)!;
    const expirationTime = timestamps.get(userData.userID) || 0;

    if (now < expirationTime) {
      const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
      context.message.reply(`⏱️ Please wait ${timeLeft} seconds before using this command again.`);
      return false;
    }

    return true;
  }

  private setCooldown(commandName: string, userID: string, cooldown: number): void {
    const now = Date.now();
    const expirationTime = now + (cooldown * 1000);

    if (!this.cooldowns.has(commandName)) {
      this.cooldowns.set(commandName, new Map());
    }

    this.cooldowns.get(commandName)!.set(userID, expirationTime);

    // Clean up expired cooldowns
    setTimeout(() => {
      this.cooldowns.get(commandName)?.delete(userID);
    }, cooldown * 1000);
  }

  hasCommand(name: string): boolean {
    const commandName = name.toLowerCase();
    return this.commands.has(commandName) || this.aliases.has(commandName);
  }

  getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }

  getAliases(): Map<string, string> {
    return new Map(this.aliases);
  }

  unregister(name: string): boolean {
    const commandName = name.toLowerCase();
    const command = this.commands.get(commandName);
    
    if (!command) return false;

    // Remove command
    this.commands.delete(commandName);

    // Remove aliases
    if (command.config.aliases) {
      for (const alias of command.config.aliases) {
        this.aliases.delete(alias.toLowerCase());
      }
    }

    // Remove cooldowns
    this.cooldowns.delete(command.config.name);

    Logger.info('COMMAND', `Unregistered command: ${name}`);
    return true;
  }

  getStats(): {
    totalCommands: number;
    totalAliases: number;
    categories: string[];
    activeCooldowns: number;
  } {
    let activeCooldowns = 0;
    for (const timestamps of this.cooldowns.values()) {
      activeCooldowns += timestamps.size;
    }

    return {
      totalCommands: this.commands.size,
      totalAliases: this.aliases.size,
      categories: this.getCategories(),
      activeCooldowns
    };
  }
}