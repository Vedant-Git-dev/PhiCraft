import mineflayer from 'mineflayer';
import express from 'express';
import dotenv from 'dotenv';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { pathfinder, Movements } = pathfinderPlugin;
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
import CraftingChain from './utils/craftingChain.js';

dotenv.config();

// Create Express server
const app = express();
app.use(express.json());

let bot = null;
let currentAction = null;
let craftingChain = null;

// Bot configuration
const BOT_CONFIG = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_NAME || 'PhiAssistant',
  auth: 'offline',
  version: process.env.MC_VERSION || '1.20.1',
  checkTimeoutInterval: 30000,
  hideErrors: false
};

// Initialize bot
function createBot() {
  bot = mineflayer.createBot(BOT_CONFIG);
  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    logSuccess('✅ Bot spawned successfully!');
    const mcData = minecraftData(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    
    // Initialize crafting chain
    craftingChain = new CraftingChain(bot);
    logSuccess('⛓️ Crafting chain system initialized');
    
    log(`📍 Position: ${bot.entity.position}`);
    log(`❤️ Health: ${bot.health}`);
    log(`🍖 Food: ${bot.food}`);
    
    bot.chat('🤖 AI Assistant online! Using Phi-3 AI');
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    log(`💬 <${username}> ${message}`);
  });

  bot.on('error', (err) => {
    logError(`Bot error: ${err.message}`);
  });

  bot.on('kicked', (reason) => {
    logError(`Bot kicked: ${reason}`);
  });

  bot.on('end', () => {
    logWarning('Bot disconnected. Reconnecting in 5 seconds...');
    setTimeout(createBot, 5000);
  });

  bot.on('health', () => {
    if (bot.health < 10) {
      logWarning(`⚠️ Low health: ${bot.health}/20`);
    }
  });

  bot.on('death', () => {
    logError('💀 Bot died! Respawning...');
    currentAction = null;
  });
}

// REST API endpoints
app.post('/command', async (req, res) => {
  const { action, params } = req.body;

  if (!bot) {
    return res.status(503).json({ success: false, error: 'Bot not initialized' });
  }

  logSuccess(`\n🎯 Executing: ${action}`);

  try {
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
        if (!params.playerName || params.playerName === 'me') {
          params.playerName = 'NearestPlayer';
        }
        result = await follow(bot, params);
        break;
      
      case 'navigate':
      case 'goto':
        result = await navigateTo(bot, params.x, params.y, params.z);
        break;
      
      case 'afk':
        result = await afk(bot, params);
        break;
      
      case 'craft':
        // Use crafting chain for automatic material gathering
        if (params.useCraftingChain && craftingChain) {
          logSuccess(`⛓️ Using crafting chain for ${params.itemName}`);
          result = await craftingChain.executeCraftingChain(
            params.itemName,
            params.count || 1
          );
        } else {
          result = await craftItem(bot, params);
        }
        break;
      
      case 'give':
        if (!params.playerName || params.playerName === 'me') {
          params.playerName = 'NearestPlayer';
        }
        result = await give(bot, params);
        break;
      
      case 'stop':
        bot.pathfinder.setGoal(null);
        currentAction = null;
        result = { success: true, message: '⏹️ Stopped all actions' };
        break;
      
      case 'status':
        const inventory = bot.inventory.items().map(item => ({
          name: item.name,
          count: item.count
        }));
        
        result = {
          success: true,
          position: bot.entity?.position,
          health: bot.health,
          food: bot.food,
          inventory: inventory,
          inventoryFull: inventory.length >= 36,
          currentAction: currentAction
        };
        break;
      
      case 'chat':
        bot.chat(params.message);
        result = { success: true, message: '💬 Message sent' };
        break;
      
      default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }

    currentAction = action;
    
    if (result.success !== false) {
      result.success = true;
    }
    
    res.json(result);

  } catch (error) {
    logError(`Command execution error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
      message: `Failed: ${error.message}`
    });
  }
});

app.get('/status', (req, res) => {
  if (!bot) {
    return res.status(503).json({ error: 'Bot not initialized' });
  }

  res.json({
    connected: bot._client?.state === 'play',
    position: bot.entity?.position,
    health: bot.health,
    food: bot.food,
    gameMode: bot.game?.gameMode,
    currentAction: currentAction,
    inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
  });
});

app.get('/inventory', (req, res) => {
  if (!bot) {
    return res.status(503).json({ error: 'Bot not initialized' });
  }

  const inventory = bot.inventory.items().reduce((acc, item) => {
    acc[item.name] = (acc[item.name] || 0) + item.count;
    return acc;
  }, {});

  res.json({
    success: true,
    inventory: inventory,
    totalSlots: bot.inventory.slots.length,
    usedSlots: bot.inventory.items().length
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    bot_ready: !!bot,
    crafting_chain_ready: !!craftingChain
  });
});

// Start server
const PORT = process.env.NODE_PORT || 3000;
app.listen(PORT, () => {
  logSuccess(`\n🚀 Node.js server listening on port ${PORT}`);
  logSuccess(`   Python should connect to: http://localhost:${PORT}`);
  createBot();
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('\n👋 Shutting down...');
  if (bot) {
    bot.quit();
  }
  process.exit(0);
});