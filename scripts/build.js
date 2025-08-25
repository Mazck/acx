const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

async function build() {
  console.log(chalk.cyan('🏗️  Building Uranus Bot...'));
  
  try {
    // Clean dist directory
    console.log(chalk.blue('🧹 Cleaning dist directory...'));
    await fs.remove('dist');
    
    // Compile TypeScript
    console.log(chalk.blue('📦 Compiling TypeScript...'));
    execSync('npx tsc', { stdio: 'inherit' });
    
    // Copy non-TS files
    console.log(chalk.blue('📋 Copying assets...'));
    await copyAssets();
    
    // Copy package.json
    await fs.copy('package.json', 'dist/package.json');
    
    console.log(chalk.green('✅ Build completed successfully!'));
    console.log(chalk.yellow('\n💡 Run: npm run start:prod'));
    
  } catch (error) {
    console.error(chalk.red('❌ Build failed:'), error.message);
    process.exit(1);
  }
}

async function copyAssets() {
  const assetDirs = [
    { src: 'assets', dest: 'dist/assets' },
    { src: 'config.json', dest: 'dist/config.json' },
    { src: '.env.example', dest: 'dist/.env.example' }
  ];

  for (const { src, dest } of assetDirs) {
    if (await fs.pathExists(src)) {
      await fs.copy(src, dest);
      console.log(chalk.gray(`  ✓ Copied: ${src} → ${dest}`));
    }
  }
}

if (require.main === module) {
  build();
}

module.exports = { build };