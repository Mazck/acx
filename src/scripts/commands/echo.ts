import { Command, MessageContext } from '../../types/interfaces';

const echoCommand: Command = {
  config: {
    name: 'echo',
    aliases: ['repeat', 'say'],
    description: 'Repeat your message',
    usage: 'echo <message>',
    category: 'fun',
    role: 0,
    cooldown: 3,
    version: '1.0.0',
    author: 'Uranus Bot Team'
  },

  onStart: async ({ args, message, userData }: MessageContext) => {
    if (args.length === 0) {
      return await message.reply('❌ Please provide a message to echo!');
    }

    const text = args.join(' ');
    await message.reply(`🔊 ${userData.name} said: "${text}"`);
  }
};

export default echoCommand;
