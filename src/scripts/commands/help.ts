// src/scripts/commands/help.ts - Enhanced version with better user experience
import { Command, MessageContext } from '../../types/interfaces';
import { Utils } from '../../utils/Utils';

const helpCommand: Command = {
  config: {
    name: 'help',
    aliases: ['h', 'commands', 'cmd', 'menu'],
    description: 'Hướng dẫn sử dụng bot một cách dễ hiểu',
    usage: 'help [tên lệnh | danh mục | trang]',
    category: 'info',
    role: 0,
    cooldown: 3,
    version: '3.0.0',
    author: 'Uranus Bot Team'
  },

  onStart: async ({ api, args, message, event, userData, threadData, prefix }: MessageContext) => {
    const commandManager = (global as any).bot.getCommandManager();

    // Nếu không có tham số, hiển thị menu chính
    if (args.length === 0) {
      return await showMainMenu(message, commandManager, prefix, threadData);
    }

    const input = args[0].toLowerCase();

    // Kiểm tra xem có phải là lệnh cụ thể không
    const command = commandManager.get(input);
    if (command) {
      return await showCommandGuide(message, command, prefix, threadData);
    }

    // Kiểm tra xem có phải là số trang không
    const pageNum = parseInt(input);
    if (!isNaN(pageNum)) {
      return await showCommandsByPage(message, commandManager, prefix, pageNum, userData.userID);
    }

    // Kiểm tra xem có phải là danh mục không
    const categories = commandManager.getCategories();
    const category = categories.find((cat: any) => cat.toLowerCase() === input);
    if (category) {
      return await showCategoryGuide(message, commandManager, prefix, category, userData.userID);
    }

    // Tìm kiếm lệnh tương tự
    const suggestions = commandManager.searchCommands(input);
    if (suggestions.length > 0) {
      return await showSearchSuggestions(message, suggestions, prefix, input);
    }

    await showNotFound(message, input, prefix);
  }
};

async function showMainMenu(message: any, commandManager: any, prefix: string, threadData: any): Promise<void> {
  const stats = commandManager.getStats();
  const categories = commandManager.getCategories();

  // Tạo menu chính thân thiện người dùng
  let mainMenu = `🪐 **CHÀO MỪNG ĐÊN URANUS BOT!** 🪐\n\n`;

  // Thông tin về nhóm và subscription
  const payosManager = (global as any).bot.getPayOSManager();
  if (payosManager) {
    const { canUse, subscription } = await payosManager.canUseBot(threadData.threadID);
    if (canUse && subscription) {
      const plan = payosManager.getPlan(subscription.planId);
      const daysLeft = Math.ceil((subscription.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      mainMenu += `✅ **Gói hiện tại:** ${plan?.name} (${daysLeft} ngày)\n\n`;
    } else {
      mainMenu += `🆓 **Dùng thử:** Sử dụng \`${prefix}subscribe trial\` để kích hoạt miễn phí!\n\n`;
    }
  }

  mainMenu += `🎯 **CÁC TÍNH NĂNG CHÍNH:**\n\n`;

  // Hiển thị các danh mục với emoji và mô tả dễ hiểu
  const categoryDescriptions = getCategoryDescriptions();
  const popularCategories = ['fun', 'economy', 'info', 'system'];

  for (const category of popularCategories) {
    if (categories.includes(category)) {
      const count = commandManager.getAllByCategory(category).length;
      const desc = categoryDescriptions[category] || category;
      mainMenu += `${getCategoryEmoji(category)} **${desc}** (${count} lệnh)\n`;
      mainMenu += `   └ \`${prefix}help ${category}\` để xem chi tiết\n\n`;
    }
  }

  // Hiển thị các danh mục còn lại
  const remainingCategories = categories.filter((cat: any) => !popularCategories.includes(cat));
  if (remainingCategories.length > 0) {
    mainMenu += `📚 **Danh mục khác:**\n`;
    for (const category of remainingCategories) {
      const count = commandManager.getAllByCategory(category).length;
      mainMenu += `• ${category} (${count}) `;
    }
    mainMenu += `\n\n`;
  }

  mainMenu += `💡 **CÁCH SỬ DỤNG:**\n`;
  mainMenu += `🔸 \`${prefix}help <tên lệnh>\` - Hướng dẫn lệnh cụ thể\n`;
  mainMenu += `🔸 \`${prefix}help <danh mục>\` - Xem lệnh theo danh mục\n`;
  mainMenu += `🔸 \`${prefix}help 1\` - Duyệt tất cả lệnh theo trang\n\n`;

  mainMenu += `🌟 **LỆNH PHỔ BIẾN:**\n`;
  const popularCommands = getPopularCommands(commandManager);
  for (const cmd of popularCommands.slice(0, 4)) {
    mainMenu += `• \`${prefix}${cmd.config.name}\` - ${cmd.config.description}\n`;
  }

  mainMenu += `\n🎮 **BẮT ĐẦU NGAY:**\n`;
  mainMenu += `• \`${prefix}ping\` - Kiểm tra bot hoạt động\n`;
  mainMenu += `• \`${prefix}balance\` - Xem số dư và level\n`;
  mainMenu += `• \`${prefix}subscribe\` - Xem gói dịch vụ\n`;

  await message.reply(mainMenu);
}

async function showCommandGuide(message: any, command: Command, prefix: string, threadData: any): Promise<void> {
  const { config } = command;

  let guide = `📖 **HƯỚNG DẪN LỆNH: ${config.name.toUpperCase()}**\n\n`;

  // Mô tả chi tiết
  guide += `📝 **Mô tả:** ${config.description}\n\n`;

  // Cách sử dụng với ví dụ
  guide += `💡 **Cách sử dụng:**\n`;
  guide += `\`${prefix}${config.usage || config.name}\`\n\n`;

  // Các tên gọi khác
  if (config.aliases && config.aliases.length > 0) {
    guide += `🔄 **Tên gọi khác:**\n`;
    for (const alias of config.aliases) {
      guide += `• \`${prefix}${alias}\`\n`;
    }
    guide += `\n`;
  }

  // Quyền hạn cần thiết
  const roleInfo = getRoleInfo(config.role);
  guide += `🔐 **Quyền hạn:** ${roleInfo.emoji} ${roleInfo.name}\n`;
  if (roleInfo.description) {
    guide += `   └ ${roleInfo.description}\n`;
  }

  // Thời gian chờ
  if (config.cooldown > 0) {
    guide += `⏱️ **Thời gian chờ:** ${config.cooldown} giây\n\n`;
  } else {
    guide += `\n`;
  }

  // Ví dụ thực tế
  const examples = getCommandExamples(config.name, prefix);
  if (examples.length > 0) {
    guide += `📋 **Ví dụ:**\n`;
    for (const example of examples) {
      guide += `🔸 \`${example.command}\`\n`;
      if (example.description) {
        guide += `   └ ${example.description}\n`;
      }
    }
    guide += `\n`;
  }

  // Lưu ý đặc biệt
  const notes = getCommandNotes(config.name, prefix);
  if (notes.length > 0) {
    guide += `⚠️ **Lưu ý:**\n`;
    for (const note of notes) {
      guide += `• ${note}\n`;
    }
    guide += `\n`;
  }

  // Thông tin bổ sung
  guide += `ℹ️ **Thông tin thêm:**\n`;
  guide += `• Danh mục: ${getCategoryName(config.category)}\n`;
  guide += `• Phiên bản: ${config.version}\n`;
  guide += `• Tác giả: ${config.author}\n\n`;

  guide += `🔗 **Lệnh liên quan:** \`${prefix}help ${config.category}\``;

  await message.reply(guide);
}

async function showCategoryGuide(message: any, commandManager: any, prefix: string, category: string, userID: string): Promise<void> {
  const commands = commandManager.getAllByCategory(category);

  if (commands.length === 0) {
    return await message.reply(`❌ Không tìm thấy lệnh nào trong danh mục "${category}"`);
  }

  let categoryGuide = `📂 **DANH MỤC: ${getCategoryName(category).toUpperCase()}**\n\n`;

  // Mô tả danh mục
  const categoryDesc = getCategoryDescriptions()[category];
  if (categoryDesc) {
    categoryGuide += `📝 ${categoryDesc}\n\n`;
  }

  // Phân loại lệnh theo mức độ phổ biến và role
  const userRole = getUserRole(userID); // Bạn có thể implement hàm này
  const availableCommands = commands.filter((cmd: any) => (cmd.config.role || 0) <= userRole);
  const restrictedCommands = commands.filter((cmd: any) => (cmd.config.role || 0) > userRole);

  if (availableCommands.length > 0) {
    categoryGuide += `✅ **LỆNH CÓ THỂ SỬ DỤNG:**\n\n`;

    // Sắp xếp theo độ phổ biến
    const sortedCommands = sortCommandsByPopularity(availableCommands, category);

    for (const cmd of sortedCommands) {
      const popularity = getCommandPopularity(cmd.config.name);
      const cooldownText = cmd.config.cooldown > 0 ? ` (${cmd.config.cooldown}s)` : '';

      categoryGuide += `${popularity.emoji} **${cmd.config.name}**${cooldownText}\n`;
      categoryGuide += `   └ ${cmd.config.description}\n`;
      categoryGuide += `   └ \`${prefix}${cmd.config.usage || cmd.config.name}\`\n\n`;
    }
  }

  if (restrictedCommands.length > 0) {
    categoryGuide += `🔒 **LỆNH CẦN QUYỀN CAO HỢN:**\n`;
    for (const cmd of restrictedCommands) {
      const roleInfo = getRoleInfo(cmd.config.role);
      categoryGuide += `• \`${cmd.config.name}\` - ${roleInfo.emoji} ${roleInfo.name}\n`;
    }
    categoryGuide += `\n`;
  }

  categoryGuide += `📊 **Thống kê:** ${availableCommands.length}/${commands.length} lệnh có thể sử dụng\n`;
  categoryGuide += `💡 **Xem thêm:** \`${prefix}help <tên lệnh>\` để biết chi tiết`;

  await message.reply(categoryGuide);
}

async function showCommandsByPage(message: any, commandManager: any, prefix: string, page: number, userID: string): Promise<void> {
  const commands = commandManager.getAll();
  const userRole = getUserRole(userID);
  const availableCommands = commands.filter((cmd: any) => (cmd.config.role || 0) <= userRole);

  const commandsPerPage = 15;
  const totalPages = Math.ceil(availableCommands.length / commandsPerPage);

  if (page < 1 || page > totalPages) {
    return await message.reply(
      `❌ **Trang không hợp lệ**\n\n` +
      `📄 Có tổng cộng **${totalPages} trang**\n` +
      `💡 Sử dụng: \`${prefix}help 1\` đến \`${prefix}help ${totalPages}\``
    );
  }

  const startIndex = (page - 1) * commandsPerPage;
  const endIndex = startIndex + commandsPerPage;
  const pageCommands = availableCommands.slice(startIndex, endIndex);

  // Nhóm lệnh theo danh mục
  const groupedCommands = groupCommandsByCategory(pageCommands);

  let commandList = `📖 **DANH SÁCH LỆNH** (Trang ${page}/${totalPages})\n`;
  commandList += `📊 Hiển thị ${pageCommands.length}/${availableCommands.length} lệnh\n\n`;

  for (const [category, categoryCommands] of Object.entries(groupedCommands)) {
    const categoryName = getCategoryName(category);
    const categoryEmoji = getCategoryEmoji(category);

    commandList += `${categoryEmoji} **${categoryName}**\n`;

    for (const cmd of categoryCommands) {
      const popularity = getCommandPopularity(cmd.config.name);
      const cooldownText = cmd.config.cooldown > 0 ? ` (${cmd.config.cooldown}s)` : '';

      commandList += `  ${popularity.emoji} \`${prefix}${cmd.config.name}\`${cooldownText} - ${Utils.truncateString(cmd.config.description, 35)}\n`;
    }
    commandList += `\n`;
  }

  // Navigation
  commandList += `📑 **Điều hướng:**\n`;
  if (page > 1) {
    commandList += `⬅️ \`${prefix}help ${page - 1}\` - Trang trước\n`;
  }
  if (page < totalPages) {
    commandList += `➡️ \`${prefix}help ${page + 1}\` - Trang sau\n`;
  }

  commandList += `\n💡 **Mẹo:** \`${prefix}help <tên lệnh>\` để xem hướng dẫn chi tiết`;

  await message.reply(commandList);
}

async function showSearchSuggestions(message: any, suggestions: any[], prefix: string, query: string): Promise<void> {
  const suggestionList = suggestions
    .slice(0, 8)
    .map((cmd, index) => {
      const popularity = getCommandPopularity(cmd.config.name);
      const roleInfo = getRoleInfo(cmd.config.role);
      return `${index + 1}. ${popularity.emoji} \`${prefix}${cmd.config.name}\` ${roleInfo.emoji}\n   └ ${cmd.config.description}`;
    })
    .join('\n\n');

  const searchResult = `🔍 **KẾT QUẢ TÌM KIẾM: "${query}"**\n\n` +
    `📋 Tìm thấy ${suggestions.length} kết quả:\n\n` +
    suggestionList + '\n\n' +
    `💡 **Sử dụng:** \`${prefix}help <số thứ tự>\` hoặc \`${prefix}help <tên lệnh>\`\n` +
    `🌟 **Xem tất cả:** \`${prefix}help\` - Menu chính`;

  await message.reply(searchResult);
}

async function showNotFound(message: any, query: string, prefix: string): Promise<void> {
  const notFoundMessage = `❌ **KHÔNG TÌM THẤY: "${query}"**\n\n` +
    `🤔 Bạn có thể đã gõ sai tên lệnh hoặc danh mục.\n\n` +
    `💡 **Gợi ý:**\n` +
    `• \`${prefix}help\` - Xem menu chính\n` +
    `• \`${prefix}help fun\` - Lệnh giải trí\n` +
    `• \`${prefix}help economy\` - Lệnh kinh tế\n` +
    `• \`${prefix}help system\` - Lệnh hệ thống\n\n` +
    `🔍 **Tìm kiếm:** Bot sẽ tự động gợi ý các lệnh tương tự khi bạn gõ sai.`;

  await message.reply(notFoundMessage);
}

// Helper functions for better categorization
function getCategoryDescriptions(): Record<string, string> {
  return {
    'fun': '🎮 Giải trí và trò chơi',
    'economy': '💰 Hệ thống kinh tế',
    'info': 'ℹ️ Thông tin và hỗ trợ',
    'system': '⚙️ Hệ thống và quản lý',
    'admin': '👑 Quản trị viên',
    'subscription': '💎 Gói dịch vụ',
    'moderation': '🛡️ Quản lý nhóm',
    'utility': '🔧 Tiện ích',
    'ai': '🤖 Trí tuệ nhân tạo',
    'music': '🎵 Âm nhạc'
  };
}

function getCategoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    'fun': '🎮',
    'economy': '💰',
    'info': 'ℹ️',
    'system': '⚙️',
    'admin': '👑',
    'subscription': '💎',
    'moderation': '🛡️',
    'utility': '🔧',
    'ai': '🤖',
    'music': '🎵'
  };

  return emojis[category] || '📦';
}

function getCategoryName(category: string): string {
  const descriptions = getCategoryDescriptions();
  return descriptions[category]?.replace(/^[^\s]+ /, '') || Utils.capitalize(category);
}

function getRoleInfo(role: number): { emoji: string; name: string; description?: string } {
  switch (role) {
    case 0:
      return {
        emoji: '👤',
        name: 'Mọi người',
        description: 'Tất cả thành viên đều có thể sử dụng'
      };
    case 1:
      return {
        emoji: '👑',
        name: 'Quản trị nhóm',
        description: 'Chỉ admin nhóm mới sử dụng được'
      };
    case 2:
      return {
        emoji: '🛡️',
        name: 'Quản trị bot',
        description: 'Chỉ admin bot mới sử dụng được'
      };
    default:
      return {
        emoji: '🔒',
        name: `Cấp ${role}`,
        description: 'Cần quyền đặc biệt'
      };
  }
}

function getCommandPopularity(commandName: string): { emoji: string; level: string } {
  // Giả lập độ phổ biến dựa trên tên lệnh
  const popularCommands = ['help', 'ping', 'balance', 'echo', 'subscribe'];
  const moderateCommands = ['status', 'redeem', 'renew'];

  if (popularCommands.includes(commandName)) {
    return { emoji: '⭐', level: 'popular' };
  } else if (moderateCommands.includes(commandName)) {
    return { emoji: '🔸', level: 'moderate' };
  } else {
    return { emoji: '▫️', level: 'normal' };
  }
}

function getPopularCommands(commandManager: any): any[] {
  const allCommands = commandManager.getAll();
  const popularNames = ['help', 'ping', 'balance', 'echo', 'subscribe', 'status'];

  return allCommands.filter((cmd: any) => popularNames.includes(cmd.config.name));
}

function groupCommandsByCategory(commands: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};

  for (const cmd of commands) {
    const category = cmd.config.category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(cmd);
  }

  return grouped;
}

function sortCommandsByPopularity(commands: any[], category: string): any[] {
  // Sắp xếp theo độ ưu tiên trong từng danh mục
  const priorityOrder: Record<string, string[]> = {
    'fun': ['echo', 'ping'],
    'economy': ['balance', 'work', 'daily'],
    'info': ['help', 'status', 'ping'],
    'subscription': ['subscribe', 'status', 'renew', 'redeem'],
    'system': ['ping', 'help', 'status']
  };

  const priority = priorityOrder[category] || [];

  return commands.sort((a, b) => {
    const aIndex = priority.indexOf(a.config.name);
    const bIndex = priority.indexOf(b.config.name);

    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    } else if (aIndex !== -1) {
      return -1;
    } else if (bIndex !== -1) {
      return 1;
    } else {
      return a.config.name.localeCompare(b.config.name);
    }
  });
}

function getCommandExamples(commandName: string, prefix: string): Array<{ command: string; description?: string }> {
  const examples: Record<string, Array<{ command: string; description?: string }>> = {
    'help': [
      { command: `${prefix}help`, description: 'Xem menu chính' },
      { command: `${prefix}help ping`, description: 'Hướng dẫn lệnh ping' },
      { command: `${prefix}help fun`, description: 'Lệnh giải trí' },
      { command: `${prefix}help 2`, description: 'Xem trang 2' }
    ],
    'echo': [
      { command: `${prefix}echo Xin chào!`, description: 'Bot sẽ lặp lại "Xin chào!"' },
      { command: `${prefix}say Bot thông minh`, description: 'Sử dụng alias "say"' }
    ],
    'balance': [
      { command: `${prefix}balance`, description: 'Xem số dư của bạn' },
      { command: `${prefix}bal`, description: 'Cách viết tắt' }
    ],
    'subscribe': [
      { command: `${prefix}subscribe`, description: 'Xem tất cả gói' },
      { command: `${prefix}subscribe basic`, description: 'Mua gói cơ bản' },
      { command: `${prefix}subscribe trial`, description: 'Dùng thử miễn phí' }
    ],
    'redeem': [
      { command: `${prefix}redeem WELCOME2024`, description: 'Sử dụng mã khuyến mãi' },
      { command: `${prefix}redeem DISCOUNT50 premium`, description: 'Áp dụng cho gói premium' }
    ]
  };

  return examples[commandName] || [];
}

function getCommandNotes(commandName: string, prefix: string): string[] {
  const notes: Record<string, string[]> = {
    'subscribe': [
      'Chỉ admin nhóm mới có thể mua gói cho nhóm',
      'Gói trial chỉ có thể sử dụng 1 lần cho mỗi nhóm',
      'Gia hạn sớm sẽ được giảm giá'
    ],
    'redeem': [
      'Mỗi mã khuyến mãi chỉ sử dụng được 1 lần cho mỗi nhóm',
      'Một số mã chỉ áp dụng cho gói cụ thể',
      'Mã có thể hết hạn hoặc hết lượt sử dụng'
    ],
    'balance': [
      'Trả lời tin nhắn của ai đó để xem số dư của họ',
      'Kinh nghiệm tăng khi tương tác với bot'
    ],
    'help': [
      'Lệnh này luôn có thể sử dụng miễn phí',
      'Hỗ trợ tìm kiếm thông minh khi gõ sai'
    ]
  };

  return notes[commandName] || [];
}

function getUserRole(userID: string): number {
  // Implement logic to get user role
  // For now, return 0 (everyone) as default
  return 0;
}

export default helpCommand;