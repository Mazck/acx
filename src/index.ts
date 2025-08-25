import { UranusBot } from './core/UranusBot';
import { Logger } from './utils/Logger';
import { Config } from './config/Config';

// Handle unhandled rejections and exceptions
process.on('unhandledRejection', (error: Error) => {
  Logger.error('UNHANDLED_REJECTION', error.message, error.stack);
});

process.on('uncaughtException', (error: Error) => {
  Logger.error('UNCAUGHT_EXCEPTION', error.message, error.stack);
  process.exit(1);
});

// Set terminal title
process.title = 'Uranus Bot';

async function startBot(): Promise<void> {
  try {
    const configInstance = await Config.load();
    const config = configInstance.getAll();
    const bot = new UranusBot(config);
    
    await bot.initialize();
    await bot.start();
    
    Logger.success('STARTUP', 'Uranus Bot started successfully!');
  } catch (error) {
    Logger.error('STARTUP', 'Failed to start Uranus Bot', error);
    process.exit(1);
  }
}

// Start the bot
startBot();