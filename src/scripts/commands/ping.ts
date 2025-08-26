import { Command, MessageContext } from '../../types/interfaces';
import { Utils } from '../../utils/Utils';

const pingCommand: Command = {
  config: {
    name: 'ping',
    aliases: ['pong', 'latency'],
    description: 'Check bot response time and system status',
    usage: 'ping',
    category: 'system',
    role: 0,
    cooldown: 5,
    version: '1.0.0',
    author: 'Uranus Bot Team'
  },

  onStart: async ({ api, message, event }: MessageContext) => {
    const startTime = Date.now();
    
    // Send initial message
     await message.reply('🏓 Pinging...');
    
    const endTime = Date.now();
    const latency = endTime - startTime;
    const uptime = (global as any).bot.getUptime();
    
    // Get system info
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const responseText = 
      `🏓 **PONG!**\n\n` +
      `⚡ **Response Time:** ${latency}ms\n` +
      `⏰ **Uptime:** ${Utils.convertDuration(uptime)}\n` +
      `💾 **Memory Usage:** ${Utils.formatBytes(memUsage.heapUsed)} / ${Utils.formatBytes(memUsage.heapTotal)}\n` +
      `🔄 **CPU Usage:** ${((cpuUsage.user + cpuUsage.system) / 1000000).toFixed(2)}ms\n` +
      `📊 **Status:** ${getStatusEmoji(latency)} ${getStatusText(latency)}\n\n` +
      `🤖 **Bot Info:**\n` +
      `• Platform: Node.js ${process.version}\n` +
      `• Process ID: ${process.pid}\n` +
      `• Environment: ${process.env.NODE_ENV || 'production'}`;

    // Edit the original message
    await message.reply(responseText);
  },

  onChat: async ({ event, message }: MessageContext) => {
    // Respond to @ping mentions
    if (event.body && event.body.toLowerCase().includes('@ping')) {
      const quickPing = Date.now();
      await message.reply(`🏓 Quick pong! ${Date.now() - quickPing}ms`);
    }
  }
};

function getStatusEmoji(latency: number): string {
  if (latency < 100) return '🟢';
  if (latency < 300) return '🟡';
  return '🔴';
}

function getStatusText(latency: number): string {
  if (latency < 100) return 'Excellent';
  if (latency < 200) return 'Good';
  if (latency < 300) return 'Fair';
  return 'Poor';
}

export default pingCommand;