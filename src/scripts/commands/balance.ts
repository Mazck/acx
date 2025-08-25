import { Command, MessageContext } from '../../types/interfaces';
import { Utils } from '../../utils/Utils';

const balanceCommand: Command = {
  config: {
    name: 'balance',
    aliases: ['bal', 'money', 'coins'],
    description: 'Check your current balance and experience points',
    usage: 'balance [@user]',
    category: 'economy',
    role: 0,
    cooldown: 3,
    version: '1.0.0',
    author: 'Uranus Bot Team'
  },

  onStart: async ({ api, args, message, event, userData }: MessageContext) => {
    let targetUserID = userData.userID;
    let targetName = userData.name;

    // Check if user mentioned someone
    if (event.messageReply) {
      targetUserID = event.messageReply.senderID;
      try {
        const targetUser = await (global as any).bot.getDatabase().users.get(targetUserID);
        if (targetUser) {
          targetName = targetUser.name;
          userData = targetUser;
        }
      } catch (error) {
        return await message.reply('❌ Could not get user information.');
      }
    } else if (args[0] && args[0].startsWith('@')) {
      // Handle @mention in text (simplified)
      return await message.reply('💡 Reply to a message to check someone else\'s balance.');
    }

    const money = userData.money || 0;
    const exp = userData.exp || 0;
    
    // Calculate level from experience
    const level = calculateLevel(exp);
    const expForNextLevel = getExpForLevel(level + 1);
    const expProgress = exp - getExpForLevel(level);
    const expNeeded = expForNextLevel - getExpForLevel(level);
    
    // Create progress bar for level
    const progressBar = Utils.createProgressBar(expProgress, expNeeded, 15);
    
    const balanceText = 
      `💰 **${targetName}'s Balance**\n\n` +
      `💵 **Money:** ${Utils.formatNumber(money)} coins\n` +
      `✨ **Experience:** ${Utils.formatNumber(exp)} XP\n` +
      `🏆 **Level:** ${level}\n\n` +
      `📊 **Level Progress:**\n` +
      `${progressBar}\n` +
      `${Utils.formatNumber(expProgress)}/${Utils.formatNumber(expNeeded)} XP\n\n` +
      `📈 **Next Level:** ${expForNextLevel - exp} XP needed\n` +
      `🎯 **Global Rank:** ${await getUserRank(targetUserID)}`;

    await message.reply(balanceText);
  }
};

function calculateLevel(exp: number): number {
  // Level formula: level = floor(sqrt(exp / 100))
  return Math.floor(Math.sqrt(exp / 100));
}

function getExpForLevel(level: number): number {
  // Reverse of level formula: exp = level^2 * 100
  return level * level * 100;
}

async function getUserRank(userID: string): Promise<string> {
  try {
    const allUsers = await (global as any).bot.getDatabase().users.getAll();
    const sortedUsers = allUsers
      .sort((a, b) => (b.exp || 0) - (a.exp || 0))
      .map(user => user.userID);
    
    const rank = sortedUsers.indexOf(userID) + 1;
    return rank > 0 ? `#${rank}` : 'Unranked';
  } catch {
    return 'Unknown';
  }
}

export default balanceCommand;