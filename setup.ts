#!/usr/bin/env tsx

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function setupUranusBot(): Promise<void> {
  console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                    🪐 URANUS BOT SETUP 🪐                     ║
║                   Welcome to the setup wizard!              ║
╚══════════════════════════════════════════════════════════════╝
  `));

  try {
    // 1. Create directories
    console.log(chalk.blue('\n📁 Creating project directories...'));
    await createDirectories();
    
    // 2. Setup configuration
    console.log(chalk.blue('\n⚙️ Setting up configuration...'));
    await setupConfiguration();
    
    // 3. Setup AppState
    console.log(chalk.blue('\n🔐 Setting up Facebook authentication...'));
    await setupAppState();
    
    // 4. Setup environment variables
    console.log(chalk.blue('\n🌍 Setting up environment variables...'));
    await setupEnvironment();
    
    // 5. Create sample commands
    console.log(chalk.blue('\n🎮 Creating sample commands...'));
    await createSampleCommands();
    
    console.log(chalk.green(`
🎉 Setup completed successfully!

Next steps:
1. Get your Facebook AppState and save it as appstate.json
2. Configure your API keys in .env file
3. Run: npm run dev

Happy botting! 🚀
    `));
    
  } catch (error) {
    console.error(chalk.red('❌ Setup failed:'), error);
  } finally {
    rl.close();
  }
}

async function createDirectories(): Promise<void> {
  const dirs = [
    'src/scripts/commands',
    'src/scripts/events',
    'src/database/base',
    'src/database/providers',
    'src/utils',
    'src/types',
    'src/config',
    'src/core',
    'src/integrations',
    'data',
    'logs',
    'temp'
  ];

  for (const dir of dirs) {
    await fs.ensureDir(dir);
    console.log(chalk.gray(`  ✓ Created: ${dir}`));
  }
}

async function setupConfiguration(): Promise<void> {
  const botName = await ask('🤖 Bot name (default: Uranus Bot): ') || 'Uranus Bot';
  const prefix = await ask('🔧 Command prefix (default: !): ') || '!';
  const adminID = await ask('👑 Your Facebook User ID: ');
  const language = await ask('🌍 Language (en/vi, default: en): ') || 'en';

  const config = {
    prefix,
    adminBot: adminID ? [adminID] : [],
    language,
    botName,
    database: {
      type: 'sqlite',
      path: './data/database.sqlite',
      autoSync: true
    },
    facebook: {
      userAgent: 'Mozilla/5.0 (Linux; Android 12; M2102J20SG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Mobile Safari/537.36',
      options: {
        forceLogin: true,
        listenEvents: true,
        logLevel: 'error',
        selfListen: false,
        updatePresence: false,
        autoMarkDelivery: false,
        autoReconnect: true
      }
    },
    features: {
      autoRestart: false,
      antiInbox: false,
      dashboard: false,
      autoLoadScripts: true
    },
    ai: {
      enable: true,
      model: 'gemini-pro',
      autoRespond: true,
      triggers: ['ai', 'uranus', 'bot']
    },
    security: {
      rateLimiting: {
        enable: true,
        maxRequests: 20,
        windowMs: 60000
      }
    }
  };

  await fs.writeJson('config.json', config, { spaces: 2 });
  console.log(chalk.green('  ✓ Configuration saved'));
}

async function setupAppState(): Promise<void> {
  console.log(chalk.yellow(`
📋 AppState Setup Instructions:

1. Install a browser extension to get Facebook AppState:
   • For Chrome: C3C FBState Extension
   • For Firefox: FBState Extractor

2. Login to Facebook in your browser
3. Use the extension to extract AppState
4. Save the AppState as 'appstate.json' in the project root

5. The file should look like:
   [
     {"key": "datr", "value": "...", "domain": ".facebook.com"},
     {"key": "c_user", "value": "...", "domain": ".facebook.com"},
     ...
   ]
  `));

  const hasAppState = await ask('Do you have your AppState ready? (y/n): ');
  
  if (hasAppState.toLowerCase() === 'y') {
    const appStatePath = await ask('Path to your AppState file (or press Enter to skip): ');
    
    if (appStatePath && await fs.pathExists(appStatePath)) {
      await fs.copy(appStatePath, 'appstate.json');
      console.log(chalk.green('  ✓ AppState copied successfully'));
    }
  } else {
    // Create empty appstate template
    await fs.writeJson('appstate.json', [], { spaces: 2 });
    console.log(chalk.yellow('  ⚠️ Empty AppState created. Please add your actual AppState data.'));
  }
}

async function setupEnvironment(): Promise<void> {
  const geminiKey = await ask('🤖 Gemini API Key (optional, for AI features): ');
  const weatherKey = await ask('🌤️ Weather API Key (optional): ');
  
  const envContent = `# Uranus Bot Environment Variables
NODE_ENV=development

# AI Integration
GEMINI_API_KEY=${geminiKey}
AI_MODEL=gemini-pro

# External APIs
WEATHER_API_KEY=${weatherKey}

# Security
JWT_SECRET=${generateRandomString(32)}
WEBHOOK_SECRET=${generateRandomString(16)}

# Features
ENABLE_AI=${geminiKey ? 'true' : 'false'}
ENABLE_ECONOMY=true
ENABLE_AUTO_RELOAD=true

# Logging
LOG_LEVEL=info
LOG_TO_FILE=true
`;

  await fs.writeFile('.env', envContent);
  console.log(chalk.green('  ✓ Environment file created'));
}

async function createSampleCommands(): Promise<void> {
  // Create a simple echo command as example
  const echoCommand = `import { Command, MessageContext } from '../../types/interfaces';

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
    await message.reply(\`🔊 \${userData.name} said: "\${text}"\`);
  }
};

export default echoCommand;
`;

  await fs.writeFile('src/scripts/commands/echo.ts', echoCommand);
  
  // Create a simple info event
  const infoEvent = `import { MessageContext } from '../../types/interfaces';

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
          '🪐 **Uranus Bot Info**\\n\\n' +
          '🚀 Modern TypeScript chatbot\\n' +
          '🤖 AI-powered assistant\\n' +
          '💰 Built-in economy system\\n' +
          '🛡️ Advanced moderation tools\\n\\n' +
          'Type \`!help\` for commands!'
        );
      };
    }
  }
};

export default infoEvent;
`;

  await fs.writeFile('src/scripts/events/info.ts', infoEvent);
  
  console.log(chalk.green('  ✓ Sample commands created'));
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupUranusBot().catch(console.error);
}

export { setupUranusBot };