import { MessageContext } from '../../types/interfaces';

const infoEvent = {
  config: {
    name: 'info',
    description: 'Provide bot information on mention',
    category: 'events',
    version: '1.0.0',
    author: 'Uranus Bot Team'
  },

  onChat: async ({ event, message }: MessageContext) => {
    if (event.body && event.body.toLowerCase().includes('uranus info')) {
      return async () => {
        await message.reply(
          '🪐 **Uranus Bot Info**\n\n' +
          '🚀 Modern TypeScript chatbot\n' +
          '🤖 AI-powered assistant\n' +
          '💰 Built-in economy system\n' +
          '🛡️ Advanced moderation tools\n\n' +
          'Type `!help` for commands!'
        );
      };
    }
  }
};

export default infoEvent;
