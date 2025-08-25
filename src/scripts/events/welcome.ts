import { MessageContext } from '../../types/interfaces';
import { Utils } from '../../utils/Utils';
import { Logger } from '../../utils/Logger';

const welcomeEvent = {
  config: {
    name: 'welcome',
    description: 'Send welcome/goodbye messages when users join or leave',
    category: 'events',
    version: '1.0.0',
    author: 'Uranus Bot Team'
  },

  onEvent: async ({ api, event, message, threadData }: MessageContext) => {
    const { logMessageType, logMessageData, threadID } = event;
    
    if (!threadData.settings.sendWelcomeMessage && !threadData.settings.sendLeaveMessage) {
      return;
    }

    switch (logMessageType) {
      case 'log:subscribe': {
        if (!threadData.settings.sendWelcomeMessage) break;
        
        const addedParticipants = logMessageData.addedParticipants || [];
        
        for (const participant of addedParticipants) {
          const { userFbId: userID, fullName } = participant;
          
          // Skip if it's the bot joining
          if (userID === (global as any).bot.getBotID()) {
            await sendBotJoinMessage(message, threadData);
            continue;
          }

          await sendWelcomeMessage(api, message, userID, fullName, threadData, threadID);
        }
        break;
      }

      case 'log:unsubscribe': {
        if (!threadData.settings.sendLeaveMessage) break;
        
        const leftParticipantFbId = logMessageData.leftParticipantFbId;
        
        if (leftParticipantFbId && leftParticipantFbId !== (global as any).bot.getBotID()) {
          await sendGoodbyeMessage(api, message, leftParticipantFbId, threadData);
        }
        break;
      }

      default:
        break;
    }
  }
};

async function sendWelcomeMessage(
  api: any,
  message: any,
  userID: string,
  userName: string,
  threadData: any,
  threadID: string
): Promise<void> {
  try {
    const memberCount = threadData.members?.length || 0;
    const customWelcome = threadData.data?.welcomeMessage;
    
    if (customWelcome) {
      const formattedMessage = customWelcome
        .replace(/{name}/g, userName)
        .replace(/{id}/g, userID)
        .replace(/{threadName}/g, threadData.threadName)
        .replace(/{memberCount}/g, memberCount.toString());
      
      await message.send(formattedMessage);
    } else {
      const defaultWelcome = 
        `🎉 **Welcome to ${threadData.threadName}!**\n\n` +
        `👋 Hello ${userName}!\n` +
        `📊 You are member #${memberCount}\n\n` +
        `🤖 I'm Uranus Bot, here to help and entertain!\n` +
        `💡 Type \`${getPrefix(threadID)}help\` to see what I can do.\n\n` +
        `🌟 Enjoy your stay and have fun! 🌟`;

      await message.send(defaultWelcome);
    }

    // Add welcome reaction
    await message.react('👋');
    
    Logger.info('WELCOME', `New member: ${userName} (${userID}) joined ${threadData.threadName}`);
  } catch (error) {
    Logger.error('WELCOME', 'Failed to send welcome message', error);
  }
}

async function sendGoodbyeMessage(
  api: any,
  message: any,
  userID: string,
  threadData: any
): Promise<void> {
  try {
    const database = (global as any).bot.getDatabase();
    const userName = await database.users.getName(userID);
    const customGoodbye = threadData.data?.goodbyeMessage;
    
    if (customGoodbye) {
      const formattedMessage = customGoodbye
        .replace(/{name}/g, userName)
        .replace(/{id}/g, userID)
        .replace(/{threadName}/g, threadData.threadName);
      
      await message.send(formattedMessage);
    } else {
      const defaultGoodbye = 
        `👋 **Goodbye!**\n\n` +
        `😢 ${userName} has left the group.\n` +
        `🌟 Thanks for being part of our community!\n` +
        `💙 You're always welcome back!`;

      await message.send(defaultGoodbye);
    }

    await message.react('👋');
    
    Logger.info('GOODBYE', `Member left: ${userName} (${userID}) from ${threadData.threadName}`);
  } catch (error) {
    Logger.error('GOODBYE', 'Failed to send goodbye message', error);
  }
}

async function sendBotJoinMessage(message: any, threadData: any): Promise<void> {
  try {
    const welcomeText = 
      `🤖 **Uranus Bot has joined the chat!**\n\n` +
      `🚀 Hello everyone! I'm Uranus Bot, your friendly assistant.\n\n` +
      `✨ **What I can do:**\n` +
      `• 🎮 Fun games and entertainment\n` +
      `• 🛠️ Useful tools and utilities\n` +
      `• 💰 Economy system with coins and levels\n` +
      `• 🎨 AI-powered features\n` +
      `• 📊 Group management tools\n\n` +
      `💡 **Get Started:**\n` +
      `Type \`${getPrefix(threadData.threadID)}help\` to see all commands!\n\n` +
      `🌟 Thanks for adding me! Let's have some fun! 🌟`;

    await message.send(welcomeText);
    
    Logger.info('BOT_JOIN', `Bot joined group: ${threadData.threadName}`);
  } catch (error) {
    Logger.error('BOT_JOIN', 'Failed to send bot join message', error);
  }
}

function getPrefix(threadID: string): string {
  const threadData = (global as any).bot.getDatabase().threads.get(threadID);
  return threadData?.data?.prefix || (global as any).bot.getConfig().prefix;
}

export default welcomeEvent;