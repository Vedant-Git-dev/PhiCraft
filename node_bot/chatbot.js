import mineflayer from 'mineflayer';
import dotenv from 'dotenv';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals: GoalsLib } = pathfinderPlugin;
import minecraftData from 'minecraft-data';
import { mine } from './actions/mine.js';
import { fight } from './actions/fight.js';
import { harvest } from './actions/harvest.js';
import { follow } from './actions/follow.js';
import { afk } from './actions/afk.js';
import { craftItem } from './actions/craft.js';
import { give } from './actions/give.js';
import { navigateTo } from './utils/navigation.js';
import { log, logError, logSuccess, logWarning } from './utils/logger.js';
import axios from 'axios';

dotenv.config();

let bot = null;
let currentAction = null;
let isProcessing = false;

// Python AI server URL (we'll call Python from Node instead)
const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://localhost:5000';

// Bot configuration
const BOT_CONFIG = {
  host: process.env.MC_HOST || '127.0.0.1',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_USERNAME || 'CraftAI_Bot',
  auth: 'offline',
  version: process.env.MC_VERSION || '1.20.1',
  checkTimeoutInterval: 30000,
  hideErrors: false
};

// Command prefix (e.g., "!mine 5 diamonds" or "@bot mine 5 diamonds")
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!';
const BOT_MENTION = `@${BOT_CONFIG.username}`;

// Initialize bot
function createBot() {
  bot = mineflayer.createBot(BOT_CONFIG);

  // Load pathfinder plugin
  bot.loadPlugin(pathfinder);

  // Bot event handlers
  bot.once('spawn', () => {
    logSuccess('Bot spawned successfully!');
    const mcData = minecraftData(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    
    log(`Position: ${bot.entity.position}`);
    log(`Health: ${bot.health}`);
    log(`Food: ${bot.food}`);
    
    // Announce presence
    setTimeout(() => {
      bot.chat('🤖 AI Bot online! Use !help for commands');
    }, 2000);
  });

  // Listen to chat messages
  bot.on('chat', async (username, message) => {
    // Ignore own messages
    if (username === bot.username) return;

    log(`<${username}> ${message}`);

    // Check if message is a command
    const isCommand = message.startsWith(COMMAND_PREFIX) || 
                     message.toLowerCase().startsWith(BOT_MENTION.toLowerCase());

    if (!isCommand) return;

    // Don't process if already busy
    if (isProcessing) {
      bot.chat(`⏳ Processing previous command, please wait...`);
      return;
    }

    // Extract command text
    let commandText = message;
    if (message.startsWith(COMMAND_PREFIX)) {
      commandText = message.slice(COMMAND_PREFIX.length).trim();
    } else if (message.toLowerCase().startsWith(BOT_MENTION.toLowerCase())) {
      commandText = message.slice(BOT_MENTION.length).trim();
    }

    if (!commandText) {
      bot.chat(`❓ Usage: ${COMMAND_PREFIX}command or ${BOT_MENTION} command`);
      return;
    }

    // Handle built-in commands
    if (commandText.toLowerCase() === 'help') {
      showHelp();
      return;
    }

    if (commandText.toLowerCase() === 'status') {
      showStatus();
      return;
    }

    if (commandText.toLowerCase() === 'stop') {
      bot.pathfinder.setGoal(null);
      currentAction = null;
      bot.chat('⏹️ Stopped all actions');
      return;
    }

    // Process AI command
    await processCommand(username, commandText);
  });

  bot.on('error', (err) => {
    logError('Bot error:', err.message);
  });

  bot.on('kicked', (reason) => {
    logError('Bot kicked:', reason);
  });

  bot.on('end', () => {
    log('Bot disconnected. Reconnecting in 5 seconds...');
    setTimeout(createBot, 5000);
  });

  bot.on('health', () => {
    if (bot.health < 10) {
      logWarning(`Low health: ${bot.health}/20`);
    }
  });

  bot.on('death', () => {
    logError('Bot died! Respawning...');
    currentAction = null;
    bot.chat('💀 I died! Respawning...');
  });
}

// Process command with AI
async function processCommand(username, commandText) {
  isProcessing = true;
  bot.chat('🤔 Processing...');

  try {
    log(`Processing command from ${username}: ${commandText}`);

    // Call Python AI to parse command
    let parsedCommand;
    
    try {
      const response = await axios.post(`${PYTHON_AI_URL}/parse`, {
        text: commandText
      }, { timeout: 10000 });

      parsedCommand = response.data;
    } catch (error) {
      // Fallback to simple parsing if Python AI is not available
      logWarning('Python AI not available, using simple parser');
      parsedCommand = simpleParser(commandText);
    }

    if (parsedCommand.error) {
      bot.chat(`❌ ${parsedCommand.error}`);
      isProcessing = false;
      return;
    }

    const { action, params } = parsedCommand;
    log(`Executing: ${action}`, params);

    // Execute the action
    let result;
    switch (action) {
      case 'mine':
        result = await mine(bot, params);
        break;
      
      case 'fight':
        result = await fight(bot, params);
        break;
      
      case 'harvest':
        result = await harvest(bot, params);
        break;
      
      case 'follow':
        // Default to the user who sent command if no player specified
        if (!params.playerName || params.playerName === 'me') {
          params.playerName = username;
        }
        result = await follow(bot, params);
        break;
      
      case 'goto':
        result = await navigateTo(bot, params.x, params.y, params.z);
        break;
      
      case 'afk':
        result = await afk(bot, params);
        break;
      
      case 'craft':
        result = await craftItem(bot, params);
        break;
      
      case 'give':
        // Default to the user who sent command
        if (!params.playerName || params.playerName === 'me') {
          params.playerName = username;
        }
        result = await give(bot, params);
        break;
      
      default:
        bot.chat(`❌ Unknown action: ${action}`);
        isProcessing = false;
        return;
    }

    currentAction = action;

    // Send success message
    if (result.success) {
      bot.chat(`✅ ${result.message}`);
      logSuccess(`Command completed: ${result.message}`);
    } else {
      bot.chat(`❌ Failed: ${result.message || 'Unknown error'}`);
      logError(`Command failed: ${result.message}`);
    }

  } catch (error) {
    logError('Error processing command:', error.message);
    bot.chat(`❌ Error: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

// Simple parser fallback (no AI)
function simpleParser(text) {
  text = text.toLowerCase();

  // Mine command
  if (text.includes('mine')) {
    const match = text.match(/(\d+)?\s*(\w+)/);
    return {
      action: 'mine',
      params: {
        blockType: match ? match[2] : 'stone',
        count: match && match[1] ? parseInt(match[1]) : 1
      }
    };
  }

  // Fight command
  if (text.includes('fight') || text.includes('attack') || text.includes('kill')) {
    return {
      action: 'fight',
      params: { mobType: 'all', radius: 16 }
    };
  }

  // Harvest command
  if (text.includes('harvest') || text.includes('farm')) {
    return {
      action: 'harvest',
      params: { cropType: 'wheat', radius: 32 }
    };
  }

  // Follow command
  if (text.includes('follow')) {
    return {
      action: 'follow',
      params: { playerName: null, distance: 3 }
    };
  }

  return { error: 'Could not understand command. Try: mine, fight, harvest, follow' };
}

// Show help
function showHelp() {
  bot.chat('🤖 Available Commands:');
  bot.chat('!mine <count> <block> - Mine blocks');
  bot.chat('!fight [mob] - Attack mobs');
  bot.chat('!harvest [crop] - Harvest crops');  
  bot.chat('!craft <item> - Craft items');
  bot.chat('!follow [player] - Follow player');
  bot.chat('!give [item] [count] - Give items');
  bot.chat('!stop - Stop current action');
  bot.chat('!status - Show bot status');
}

// Show status
function showStatus() {
  bot.chat(`❤️ Health: ${bot.health}/20 | 🍖 Food: ${bot.food}/20`);
  const pos = bot.entity.position;
  bot.chat(`📍 Position: ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`);
  if (currentAction) {
    bot.chat(`⚙️ Action: ${currentAction}`);
  }
}

// Start the bot
log('Starting Minecraft chat bot...');
createBot();

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down...');
  if (bot) {
    bot.chat('👋 Going offline...');
    bot.quit();
  }
  process.exit(0);
});