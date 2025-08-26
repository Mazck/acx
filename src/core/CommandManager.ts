import { Command, MessageContext } from '../types/interfaces';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';

export class CommandManager {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, string> = new Map();
  private cooldowns: Map<string, Map<string, number>> = new Map();
  private commandUsage: Map<string, number> = new Map();

  register(command: Command): void {
    const { name, aliases } = command.config;

    // Validate command before registration
    if (!this.validateCommand(command)) {
      Logger.error('COMMAND', `Invalid command: ${name}`);
      return;
    }

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

    // Initialize usage counter
    this.commandUsage.set(name.toLowerCase(), 0);

    Logger.debug('COMMAND', `Registered command: ${name} with ${aliases?.length || 0} aliases`);
  }

  private validateCommand(command: Command): boolean {
    if (!command || !command.config) {
      Logger.error('COMMAND', 'Command missing config');
      return false;
    }

    const { name, description, category } = command.config;
    if (!name || !description || !category) {
      Logger.error('COMMAND', 'Command missing required config fields (name, description, category)');
      return false;
    }

    if (typeof command.onStart !== 'function') {
      Logger.error('COMMAND', `Command ${name} missing onStart function`);
      return false;
    }

    // Validate role
    if (command.config.role !== undefined && (command.config.role < 0 || command.config.role > 2)) {
      Logger.error('COMMAND', `Command ${name} has invalid role: ${command.config.role}`);
      return false;
    }

    // Validate cooldown
    if (command.config.cooldown !== undefined && command.config.cooldown < 0) {
      Logger.error('COMMAND', `Command ${name} has invalid cooldown: ${command.config.cooldown}`);
      return false;
    }

    return true;
  }

  get(name: string): Command | undefined {
    if (!name || typeof name !== 'string') return undefined;

    const commandName = name.toLowerCase();
    return this.commands.get(commandName) || this.commands.get(this.aliases.get(commandName) || '');
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  getAllByCategory(category: string): Command[] {
    if (!category || typeof category !== 'string') return [];
    return this.getAll().filter(cmd => cmd.config.category.toLowerCase() === category.toLowerCase());
  }

  getCategories(): string[] {
    const categories = new Set<string>();
    for (const command of this.commands.values()) {
      if (command.config.category) {
        categories.add(command.config.category);
      }
    }
    return Array.from(categories).sort();
  }

  async executeCommand(context: MessageContext): Promise<boolean> {
    const { args, userData, threadData } = context;
    const commandName = args[0]?.toLowerCase();

    if (!commandName) {
      Logger.debug('COMMAND', 'No command name provided');
      return false;
    }

    const command = this.get(commandName);
    if (!command) {
      Logger.debug('COMMAND', `Command not found: ${commandName}`);
      return false;
    }

    // Check permissions
    if (!this.checkPermissions(command, context)) {
      return true; // Command exists but no permission
    }

    // Check cooldown
    if (!this.checkCooldown(command, context)) {
      return true; // Command exists but on cooldown
    }

    // Check if user/thread is banned
    if (!this.checkBanStatus(command, context)) {
      return true; // Command exists but user/thread is banned
    }

    try {
      // Set cooldown
      this.setCooldown(command.config.name, userData.userID, command.config.cooldown || 0);

      // Increment usage counter
      const currentUsage = this.commandUsage.get(command.config.name.toLowerCase()) || 0;
      this.commandUsage.set(command.config.name.toLowerCase(), currentUsage + 1);

      // Execute command
      const newContext = {
        ...context,
        commandName: command.config.name,
        args: args.slice(1)
      };

      // Log command execution start
      Logger.debug('COMMAND', `Executing command: ${command.config.name}`, {
        user: userData.name,
        userID: userData.userID,
        thread: threadData.threadID,
        args: newContext.args
      });

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
      Logger.error('COMMAND', `Error executing ${command.config.name}`, {
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
        user: userData.userID,
        thread: threadData.threadID
      });

      try {
        const errorMessage = process.env.NODE_ENV === 'development'
          ? `❌ Command error: ${error.message}`
          : `❌ An error occurred while executing the command. Please try again later.`;

        await context.message.reply(errorMessage);
      } catch (replyError) {
        Logger.error('COMMAND', 'Failed to send error message', replyError);
      }

      return true;
    }
  }

  private checkPermissions(command: Command, context: MessageContext): boolean {
    const { userData, threadData, role, message } = context;
    const requiredRole = command.config.role || 0;

    if (requiredRole > role) {
      const roleNames = ['Everyone', 'Group Admin', 'Bot Admin'];
      const requiredRoleName = roleNames[requiredRole] || `Role ${requiredRole}`;

      message.reply(`❌ You need **${requiredRoleName}** permission to use this command.`)
        .catch(error => Logger.error('COMMAND', 'Failed to send permission error', error));
      return false;
    }

    return true;
  }

  private checkBanStatus(command: Command, context: MessageContext): boolean {
    const { userData, threadData, message } = context;

    // Check if user is banned
    if (userData.banned && userData.banned.status) {
      const banReason = userData.banned.reason || 'No reason provided';
      const banDate = userData.banned.date ? new Date(userData.banned.date).toLocaleDateString() : 'Unknown';

      message.reply(`❌ **You are banned from using commands**\n\n` +
        `📅 **Date:** ${banDate}\n` +
        `📝 **Reason:** ${banReason}\n\n` +
        `Contact an admin if you believe this is a mistake.`)
        .catch(error => Logger.error('COMMAND', 'Failed to send ban error', error));
      return false;
    }

    // Check if thread is banned (for group chats)
    if (context.event.isGroup && threadData.banned && threadData.banned.status) {
      const banReason = threadData.banned.reason || 'No reason provided';
      const banDate = threadData.banned.date ? new Date(threadData.banned.date).toLocaleDateString() : 'Unknown';

      message.reply(`❌ **This group is banned from using commands**\n\n` +
        `📅 **Date:** ${banDate}\n` +
        `📝 **Reason:** ${banReason}\n\n` +
        `Contact a bot admin for more information.`)
        .catch(error => Logger.error('COMMAND', 'Failed to send thread ban error', error));
      return false;
    }

    return true;
  }

  private checkCooldown(command: Command, context: MessageContext): boolean {
    const { userData, message } = context;
    const commandName = command.config.name;
    const cooldownAmount = (command.config.cooldown || 1) * 1000;

    // Skip cooldown for bot admins
    if (context.role >= 2) {
      return true;
    }

    if (!this.cooldowns.has(commandName)) {
      this.cooldowns.set(commandName, new Map());
    }

    const now = Date.now();
    const timestamps = this.cooldowns.get(commandName)!;
    const expirationTime = timestamps.get(userData.userID) || 0;

    if (now < expirationTime) {
      const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
      message.reply(`⏱️ **Command on cooldown**\n\n` +
        `Please wait **${timeLeft} seconds** before using this command again.`)
        .catch(error => Logger.error('COMMAND', 'Failed to send cooldown error', error));
      return false;
    }

    return true;
  }

  private setCooldown(commandName: string, userID: string, cooldown: number): void {
    if (cooldown <= 0) return;

    const now = Date.now();
    const expirationTime = now + (cooldown * 1000);

    if (!this.cooldowns.has(commandName)) {
      this.cooldowns.set(commandName, new Map());
    }

    this.cooldowns.get(commandName)!.set(userID, expirationTime);

    // Clean up expired cooldowns
    setTimeout(() => {
      const timestamps = this.cooldowns.get(commandName);
      if (timestamps) {
        timestamps.delete(userID);
        // If no more cooldowns for this command, remove the command entry
        if (timestamps.size === 0) {
          this.cooldowns.delete(commandName);
        }
      }
    }, cooldown * 1000);
  }

  hasCommand(name: string): boolean {
    if (!name || typeof name !== 'string') return false;

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
    if (!name || typeof name !== 'string') return false;

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

    // Remove usage stats
    this.commandUsage.delete(commandName);

    Logger.info('COMMAND', `Unregistered command: ${name}`);
    return true;
  }

  getStats(): {
    totalCommands: number;
    totalAliases: number;
    categories: string[];
    activeCooldowns: number;
    totalUsage: number;
  } {
    let activeCooldowns = 0;
    for (const timestamps of this.cooldowns.values()) {
      activeCooldowns += timestamps.size;
    }

    let totalUsage = 0;
    for (const usage of this.commandUsage.values()) {
      totalUsage += usage;
    }

    return {
      totalCommands: this.commands.size,
      totalAliases: this.aliases.size,
      categories: this.getCategories(),
      activeCooldowns,
      totalUsage
    };
  }

  searchCommands(query: string): Command[] {
    if (!query || typeof query !== 'string') return [];

    const results: Command[] = [];
    const lowerQuery = query.toLowerCase();

    for (const command of this.commands.values()) {
      const score = this.calculateSearchScore(command, lowerQuery);
      if (score > 0) {
        results.push(command);
      }
    }

    // Sort by relevance score
    return results.sort((a, b) => {
      const scoreA = this.calculateSearchScore(a, lowerQuery);
      const scoreB = this.calculateSearchScore(b, lowerQuery);
      return scoreB - scoreA;
    });
  }

  private calculateSearchScore(command: Command, query: string): number {
    let score = 0;

    // Exact name match
    if (command.config.name.toLowerCase() === query) {
      score += 100;
    }
    // Name contains query
    else if (command.config.name.toLowerCase().includes(query)) {
      score += 50;
    }

    // Alias matches
    if (command.config.aliases) {
      for (const alias of command.config.aliases) {
        if (alias.toLowerCase() === query) {
          score += 80;
        } else if (alias.toLowerCase().includes(query)) {
          score += 30;
        }
      }
    }

    // Description contains query
    if (command.config.description.toLowerCase().includes(query)) {
      score += 20;
    }

    // Category matches
    if (command.config.category.toLowerCase().includes(query)) {
      score += 10;
    }

    return score;
  }

  getCommandByName(name: string): Command | undefined {
    return this.get(name);
  }

  getCommandsByRole(role: number): Command[] {
    return this.getAll().filter(cmd => (cmd.config.role || 0) <= role);
  }

  getCommandsByAuthor(author: string): Command[] {
    if (!author || typeof author !== 'string') return [];

    return this.getAll().filter(cmd =>
      cmd.config.author && cmd.config.author.toLowerCase().includes(author.toLowerCase())
    );
  }

  getPopularCommands(limit: number = 10): Array<{ command: Command, usage: number }> {
    const commandsWithUsage = [];

    for (const [name, command] of this.commands) {
      const usage = this.commandUsage.get(name) || 0;
      commandsWithUsage.push({ command, usage });
    }

    return commandsWithUsage
      .sort((a, b) => b.usage - a.usage)
      .slice(0, limit);
  }

  clearCooldowns(userID?: string): void {
    if (userID) {
      // Clear cooldowns for specific user
      for (const timestamps of this.cooldowns.values()) {
        timestamps.delete(userID);
      }
      Logger.info('COMMAND', `Cleared cooldowns for user: ${userID}`);
    } else {
      // Clear all cooldowns
      this.cooldowns.clear();
      Logger.info('COMMAND', 'Cleared all cooldowns');
    }
  }

  getCooldownInfo(commandName: string, userID: string): {
    isOnCooldown: boolean;
    remainingTime: number;
  } {
    if (!this.cooldowns.has(commandName)) {
      return { isOnCooldown: false, remainingTime: 0 };
    }

    const timestamps = this.cooldowns.get(commandName)!;
    const expirationTime = timestamps.get(userID) || 0;
    const now = Date.now();

    if (now < expirationTime) {
      return {
        isOnCooldown: true,
        remainingTime: Math.ceil((expirationTime - now) / 1000)
      };
    }

    return { isOnCooldown: false, remainingTime: 0 };
  }

  getCommandUsage(commandName: string): number {
    return this.commandUsage.get(commandName.toLowerCase()) || 0;
  }

  resetUsageStats(): void {
    this.commandUsage.clear();
    for (const command of this.commands.keys()) {
      this.commandUsage.set(command, 0);
    }
    Logger.info('COMMAND', 'Reset all usage statistics');
  }

  // Advanced search with filters
  advancedSearch(options: {
    query?: string;
    category?: string;
    role?: number;
    author?: string;
    minUsage?: number;
  }): Command[] {
    let results = this.getAll();

    // Apply filters
    if (options.query) {
      results = this.searchCommands(options.query);
    }

    if (options.category) {
      results = results.filter(cmd =>
        cmd.config.category.toLowerCase() === options.category!.toLowerCase()
      );
    }

    if (options.role !== undefined) {
      results = results.filter(cmd => (cmd.config.role || 0) <= options.role!);
    }

    if (options.author) {
      results = results.filter(cmd =>
        cmd.config.author && cmd.config.author.toLowerCase().includes(options.author!.toLowerCase())
      );
    }

    if (options.minUsage !== undefined) {
      results = results.filter(cmd =>
        (this.commandUsage.get(cmd.config.name.toLowerCase()) || 0) >= options.minUsage!
      );
    }

    return results;
  }

  // Export command data for backup
  exportCommands(): {
    commands: Array<{
      name: string;
      config: any;
      usage: number;
    }>;
    aliases: Record<string, string>;
    stats: any;
  } {
    const commands = [];

    for (const [name, command] of this.commands) {
      commands.push({
        name,
        config: command.config,
        usage: this.commandUsage.get(name) || 0
      });
    }

    return {
      commands,
      aliases: Object.fromEntries(this.aliases),
      stats: this.getStats()
    };
  }

  // Cleanup method for graceful shutdown
  cleanup(): void {
    Logger.info('COMMAND', 'Cleaning up command manager...');

    // Save final stats if needed
    const stats = this.getStats();
    Logger.info('COMMAND', 'Final command statistics', stats);

    this.commands.clear();
    this.aliases.clear();
    this.cooldowns.clear();
    this.commandUsage.clear();

    Logger.info('COMMAND', 'Command manager cleanup completed');
  }

  // Diagnostic methods
  diagnose(): {
    issues: string[];
    warnings: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Check for commands without proper configuration
    for (const [name, command] of this.commands) {
      if (!command.config.usage) {
        warnings.push(`Command ${name} missing usage information`);
      }

      if (!command.config.version) {
        warnings.push(`Command ${name} missing version information`);
      }

      if (!command.config.author) {
        warnings.push(`Command ${name} missing author information`);
      }

      if ((command.config.cooldown || 0) === 0) {
        suggestions.push(`Consider adding cooldown to command ${name}`);
      }
    }

    // Check for duplicate descriptions
    const descriptions = new Map<string, string[]>();
    for (const [name, command] of this.commands) {
      const desc = command.config.description;
      if (!descriptions.has(desc)) {
        descriptions.set(desc, []);
      }
      descriptions.get(desc)!.push(name);
    }

    for (const [desc, commands] of descriptions) {
      if (commands.length > 1) {
        warnings.push(`Duplicate description "${desc}" for commands: ${commands.join(', ')}`);
      }
    }

    // Check category distribution
    const categoryCount = new Map<string, number>();
    for (const command of this.commands.values()) {
      const cat = command.config.category;
      categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
    }

    const maxCategorySize = Math.max(...categoryCount.values());
    if (maxCategorySize > 10) {
      const largeCats = Array.from(categoryCount.entries())
        .filter(([, count]) => count > 10)
        .map(([cat]) => cat);
      suggestions.push(`Consider splitting large categories: ${largeCats.join(', ')}`);
    }

    return { issues, warnings, suggestions };
  }
}