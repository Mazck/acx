import { Command, MessageContext } from '../../types/interfaces';
import { Utils } from '../../utils/Utils';

const helpCommand: Command = {
  config: {
    name: 'help',
    aliases: ['h', 'commands', 'cmd'],
    description: 'View command usage and information',
    usage: 'help [command name | page number | category]',
    category: 'info',
    role: 0,
    cooldown: 3,
    version: '2.0.0',
    author: 'Uranus Bot Team'
  },

  onStart: async ({ api, args, message, event, userData, threadData, prefix }: MessageContext) => {
    const commandManager = (global as any).bot.getCommandManager();
    
    // If no arguments, show general help
    if (args.length === 0) {
      return await showGeneralHelp(message, commandManager, prefix);
    }

    const input = args[0].toLowerCase();

    // Check if it's a specific command
    const command = commandManager.get(input);
    if (command) {
      return await showCommandDetails(message, command, prefix, threadData);
    }

    // Check if it's a page number
    const pageNum = parseInt(input);
    if (!isNaN(pageNum)) {
      return await showCommandList(message, commandManager, prefix, pageNum);
    }

    // Check if it's a category
    const categories = commandManager.getCategories();
    const category = categories.find(cat => cat.toLowerCase() === input);
    if (category) {
      return await showCategoryCommands(message, commandManager, prefix, category);
    }

    // Search for similar commands
    const suggestions = commandManager.searchCommands(input);
    if (suggestions.length > 0) {
      const suggestionList = suggestions
        .slice(0, 5)
        .map(cmd => `• \`${prefix}${cmd.config.name}\` - ${cmd.config.description}`)
        .join('\n');
      
      return await message.reply(
        `❌ Command "${input}" not found.\n\n` +
        `📋 Did you mean:\n${suggestionList}\n\n` +
        `💡 Use \`${prefix}help\` to see all commands.`
      );
    }

    await message.reply(`❌ Command "${input}" not found. Use \`${prefix}help\` to see all commands.`);
  }
};

async function showGeneralHelp(message: any, commandManager: any, prefix: string): Promise<void> {
  const stats = commandManager.getStats();
  const categories = commandManager.getCategories();
  
  const helpText = 
    `🪐 **URANUS BOT - HELP MENU** 🪐\n\n` +
    `📊 **Statistics:**\n` +
    `• Total Commands: ${stats.totalCommands}\n` +
    `• Total Aliases: ${stats.totalAliases}\n` +
    `• Categories: ${categories.length}\n\n` +
    `📋 **Categories:**\n` +
    categories.map(cat => `• \`${prefix}help ${cat}\` - ${cap(cat)} commands`).join('\n') + '\n\n' +
    `💡 **Usage:**\n` +
    `• \`${prefix}help <command>\` - View command details\n` +
    `• \`${prefix}help <page>\` - Browse commands by page\n` +
    `• \`${prefix}help <category>\` - View category commands\n\n` +
    `🔧 **Examples:**\n` +
    `• \`${prefix}help ping\` - Info about ping command\n` +
    `• \`${prefix}help 1\` - First page of commands\n` +
    `• \`${prefix}help fun\` - All fun commands`;

  await message.reply(helpText);
}

async function showCommandList(message: any, commandManager: any, prefix: string, page: number): Promise<void> {
  const commands = commandManager.getAll();
  const commandsPerPage = 20;
  const totalPages = Math.ceil(commands.length / commandsPerPage);
  
  if (page < 1 || page > totalPages) {
    return await message.reply(`❌ Invalid page number. Available pages: 1-${totalPages}`);
  }

  const startIndex = (page - 1) * commandsPerPage;
  const endIndex = startIndex + commandsPerPage;
  const pageCommands = commands.slice(startIndex, endIndex);

  const commandList = pageCommands
    .map((cmd, index) => {
      const num = startIndex + index + 1;
      return `${num.toString().padStart(2, '0')}. \`${prefix}${cmd.config.name}\` - ${Utils.truncateString(cmd.config.description, 40)}`;
    })
    .join('\n');

  const helpText = 
    `📋 **COMMAND LIST** (Page ${page}/${totalPages})\n\n` +
    commandList + '\n\n' +
    `💡 Use \`${prefix}help <command>\` for details\n` +
    `📄 Navigate: \`${prefix}help ${page > 1 ? page - 1 : totalPages}\` | \`${prefix}help ${page < totalPages ? page + 1 : 1}\``;

  await message.reply(helpText);
}

async function showCategoryCommands(message: any, commandManager: any, prefix: string, category: string): Promise<void> {
  const commands = commandManager.getAllByCategory(category);
  
  if (commands.length === 0) {
    return await message.reply(`❌ No commands found in category "${category}"`);
  }

  const commandList = commands
    .map(cmd => `• \`${prefix}${cmd.config.name}\` - ${cmd.config.description}`)
    .join('\n');

  const helpText = 
    `📂 **${category.toUpperCase()} COMMANDS**\n\n` +
    commandList + '\n\n' +
    `📊 Total: ${commands.length} commands\n` +
    `💡 Use \`${prefix}help <command>\` for details`;

  await message.reply(helpText);
}

async function showCommandDetails(message: any, command: Command, prefix: string, threadData: any): Promise<void> {
  const { config } = command;
  const aliases = config.aliases ? config.aliases.join(', ') : 'None';
  
  // Check for group-specific aliases
  const groupAliases = threadData.data?.aliases?.[config.name];
  const groupAliasesStr = groupAliases ? groupAliases.join(', ') : 'None';
  
  const roleText = getRoleText(config.role);
  
  const detailText = 
    `📌 **COMMAND DETAILS**\n\n` +
    `🧩 **Name:** ${config.name}\n` +
    `📝 **Description:** ${config.description}\n` +
    `📂 **Category:** ${config.category}\n` +
    `🔁 **Aliases:** ${aliases}\n` +
    `👥 **Group Aliases:** ${groupAliasesStr}\n` +
    `🔒 **Role Required:** ${roleText}\n` +
    `⏱️ **Cooldown:** ${config.cooldown}s\n` +
    `🏷️ **Version:** ${config.version}\n` +
    `👨‍💻 **Author:** ${config.author}\n\n` +
    `💡 **Usage:**\n\`${prefix}${config.usage || config.name}\`\n\n` +
    `📎 **Notes:**\n` +
    `• <...> = required parameter\n` +
    `• [...] = optional parameter\n` +
    `• <a|b|c> = choose one option`;

  await message.reply(detailText);
}

function getRoleText(role: number): string {
  switch (role) {
    case 0: return '👤 Everyone';
    case 1: return '👑 Group Admin';
    case 2: return '🛡️ Bot Admin';
    default: return `🔒 Role ${role}`;
  }
}

function cap(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default helpCommand;