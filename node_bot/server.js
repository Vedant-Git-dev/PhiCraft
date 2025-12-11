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
import axios from 'axios';
import { initRecipeSystem } from './actions/craft.js';
import { 
  loadBlueprint,
  getRequiredMaterials,
  buildStructure,
  previewBuild,
  listSchematics
} from './actions/build.js';

dotenv.config();

const app = express();
app.use(express.json());

let bot = null;
let currentAction = null;
let craftingChain = null;
let isProcessing = false;
let currentBlueprint = null;
let buildExecutor = null;

const COLAB_SERVER_URL = process.env.COLAB_SERVER_URL || 'http://localhost:5000';

const BOT_CONFIG = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_USERNAME || 'PhiAssistant',
  auth: 'offline',
  version: process.env.MC_VERSION || '1.20.1',
  checkTimeoutInterval: 30000,
  hideErrors: false
};

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!';
const BOT_MENTION = `@${BOT_CONFIG.username}`;

async function testColabConnection() {
  logWarning('\n🔍 Testing Colab connection...');
  log(`   URL: ${COLAB_SERVER_URL}`);
  
  if (!COLAB_SERVER_URL || COLAB_SERVER_URL.includes('your-ngrok-url')) {
    logError('❌ COLAB_SERVER_URL not configured!');
    return false;
  }

  try {
    const response = await axios.get(`${COLAB_SERVER_URL}/health`, {
      timeout: 5000,
      validateStatus: () => true
    });

    if (response.status === 200) {
      logSuccess('✅ Connected to Colab server!');
      log(`   Model loaded: ${response.data.model_loaded}`);
      return true;
    }
    return false;
  } catch (error) {
    logError(`❌ Connection failed: ${error.message}`);
    return false;
  }
}

function createBot() {
  bot = mineflayer.createBot(BOT_CONFIG);
  bot.loadPlugin(pathfinder);

  bot.once('spawn', async () => {
    logSuccess('✅ Bot spawned successfully!');
    const mcData = minecraftData(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    
    craftingChain = new CraftingChain(bot);
    logSuccess('⛓️ Crafting chain system initialized');

    try {
      await initRecipeSystem(bot);
      logSuccess('📚 Recipe database loaded!');
    } catch (error) {
      logWarning(`Recipe database failed: ${error.message}`);
    }
    
    log(`📍 Position: ${bot.entity.position}`);
    log(`❤️ Health: ${bot.health}`);
    log(`🍖 Food: ${bot.food}`);
    
    const connected = await testColabConnection();
    
    setTimeout(() => {
      if (connected) {
        bot.chat('🤖 AI Bot online! I can understand natural language!');
        bot.chat('Try: "how are you?" or "get me 5 logs"');
        logSuccess('💬 Advanced NLP ready!');
      } else {
        bot.chat('⚠️ Bot online but AI not connected');
        logWarning('⚠️ AI server not connected');
      }
    }, 2000);

  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;

    if (buildExecutor && buildExecutor.currentPrompt) {
      const handled = buildExecutor.handleUserResponse(message);
      if (handled) {
        return; // Message was a response to build prompt
  }
}

    log(`💬 <${username}> ${message}`);

    const isCommand = message.startsWith(COMMAND_PREFIX);
    const isMention = message.toLowerCase().includes(BOT_MENTION.toLowerCase()) || 
                      message.toLowerCase().includes(bot.username.toLowerCase());
    const isQuestion = message.includes('?');
    const isNaturalCommand = containsActionKeywords(message);

    // Respond to questions and commands
    if (!isCommand && !isMention && !isNaturalCommand && !isQuestion) {
      return;
    }

    if (isProcessing) {
      bot.chat(`⏳ I'm working on something, please wait...`);
      return;
    }

    let commandText = message;
    if (message.startsWith(COMMAND_PREFIX)) {
      commandText = message.slice(COMMAND_PREFIX.length).trim();
    } else if (isMention) {
      commandText = message
        .replace(new RegExp(BOT_MENTION, 'gi'), '')
        .replace(new RegExp(bot.username, 'gi'), '')
        .trim();
    }

    if (!commandText) {
      bot.chat(`❓ Yes? What can I do for you?`);
      return;
    }

    // Built-in commands
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

    if (commandText.toLowerCase() === 'test') {
      bot.chat('🧪 Testing Colab...');
      const connected = await testColabConnection();
      bot.chat(connected ? '✅ Colab working!' : '❌ Cannot reach Colab');
      return;
    }

    if (commandText.toLowerCase() === 'list blueprints' || 
      commandText.toLowerCase() === 'list schematics') {
      try {
        const result = await listSchematics(bot, { directory: './schematics' });
        if (result.schematics.length === 0) {
          bot.chat('No blueprints found');
        } else {
          bot.chat(`Blueprints (${result.count}):`);
          result.schematics.slice(0, 5).forEach(name => bot.chat(`  ${name}`));
        }
      } catch (error) {
        bot.chat(`Error: ${error.message}`);
      }
      return;
}
    if (commandText.toLowerCase().startsWith('load blueprint ')) {
  try {
    const name = commandText.replace(/load blueprint /i, '').trim();
    const path = `./schematics/${name}`;
    bot.chat(`Loading ${name}...`);
    const result = await loadBlueprint(bot, { filePath: path });
    if (result.success) {
      currentBlueprint = result.blueprint;
      bot.chat(`Loaded: ${result.size.x}x${result.size.y}x${result.size.z}`);
      bot.chat(`Blocks: ${result.totalBlocks}`);
    }
  } catch (error) {
    bot.chat(`Error: ${error.message}`);
  }
  return;
}

// --- CHECK MATERIALS ---
if (commandText.toLowerCase() === 'check materials') {
  try {
    if (!currentBlueprint) {
      bot.chat('No blueprint loaded!');
      return;
    }
    const result = await getRequiredMaterials(bot, { blueprint: currentBlueprint });
    if (result.hasAllResources) {
      bot.chat('All materials available!');
    } else {
      bot.chat(`Missing ${Object.keys(result.missing).length} types:`);
      Object.entries(result.missing).slice(0, 5).forEach(([item, count]) => {
        bot.chat(`  ${item}: ${count}`);
      });
    }
  } catch (error) {
    bot.chat(`Error: ${error.message}`);
  }
  return;
}

// --- GATHER MATERIALS ---
if (commandText.toLowerCase() === 'gather materials') {
  try {
    if (!currentBlueprint) {
      bot.chat('No blueprint loaded!');
      return;
    }
    const check = await getRequiredMaterials(bot, { blueprint: currentBlueprint });
    if (check.hasAllResources) {
      bot.chat('Already have all materials!');
      return;
    }
    bot.chat('Gathering materials...');
    for (const [item, count] of Object.entries(check.missing)) {
      bot.chat(`Getting ${count}x ${item}...`);
      try {
        const { give } = await import('./actions/give.js');
        await give(bot, { playerName: username, itemName: item, count });
        await sleep(500);
      } catch (error) {
        bot.chat(`Failed: ${item}`);
      }
    }
    bot.chat('Done! Say "build" to start.');
  } catch (error) {
    bot.chat(`Error: ${error.message}`);
  }
  return;
}

// --- BUILD ---
if (commandText.toLowerCase() === 'build' || 
    commandText.toLowerCase() === 'build it') {
  try {
    if (!currentBlueprint) {
      bot.chat('No blueprint loaded!');
      return;
    }
    
    const check = await getRequiredMaterials(bot, { blueprint: currentBlueprint });
    if (!check.hasAllResources) {
      bot.chat('Missing materials! Say "gather materials"');
      return;
    }
    
    bot.chat('Starting build process...');
    
    // Initialize build executor
    if (!buildExecutor) {
      const BuildExecutor = (await import('./utils/buildExecutor.js')).default;
      buildExecutor = new BuildExecutor(bot);
    }
    
    // Build will ask user for Y-level and coordinates
    const result = await buildExecutor.buildStructure(currentBlueprint, null, {
      layerByLayer: true,
      prepareGround: true,
      clearArea: true
    });
    
    if (result.success) {
      bot.chat(`✅ Build complete! Placed ${result.placed} blocks in ${result.duration}s`);
      bot.chat(`Failed: ${result.failed}, Skipped: ${result.skipped}, Cleared: ${result.cleared}`);
    } else if (result.status === 'cancelled') {
      bot.chat(`Build cancelled`);
    } else {
      bot.chat(`❌ Build failed: ${result.error || result.message}`);
    }
    
    currentBlueprint = null;
  } catch (error) {
    bot.chat(`Error: ${error.message}`);
    logError(`Build error: ${error.message}`);
  }
  return;
}

    // --- BUILD HELP ---
    if (commandText.toLowerCase() === 'build help') {
      bot.chat('Build Commands:');
      bot.chat('  list blueprints');
      bot.chat('  load blueprint <name>');
      bot.chat('  check materials');
      bot.chat('  gather materials');
      bot.chat('  build');
      return;
    }

    // Process with AI
    await processInGameCommand(username, commandText);
  });

  bot.on('error', (err) => logError('Bot error:', err.message));
  bot.on('kicked', (reason) => logError('Bot kicked:', reason));
  bot.on('end', () => {
    logWarning('Bot disconnected. Reconnecting in 5 seconds...');
    setTimeout(createBot, 5000);
  });
  bot.on('health', () => {
    if (bot.health < 10) logWarning(`⚠️ Low health: ${bot.health}/20`);
  });
  bot.on('death', () => {
    logError('💀 Bot died!');
    currentAction = null;
    bot.chat('💀 I died! Respawning...');
  });
}

// Execute a single action
async function executeAction(action, params, username) {
  log(`🎯 Executing: ${action}`);
  
  let result;
  
  switch (action) {
    case 'respond':
      // Just chat back
      bot.chat(params.message || 'Hello!');
      return { success: true, message: 'Responded' };
    
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
        params.playerName = username;
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
      params.useCraftingChain = true;
      if (craftingChain) {
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
        params.playerName = username;
      }
      result = await give(bot, params);
      break;
    
    case 'stop':
      bot.pathfinder.setGoal(null);
      currentAction = null;
      result = { success: true, message: 'Stopped' };
      break;
    
    case 'status':
      showStatus();
      result = { success: true, message: 'Status shown' };
      break;

    case 'smelt':
      const { smelt } = await import('./actions/smelt.js');
      result = await smelt(bot, params);
      break;
    
    case 'load_blueprint':
      result = await loadBlueprint(bot, params);
      break;

    case 'get_required_materials':
      result = await getRequiredMaterials(bot, params);
      break;

    case 'build_structure':
      // Initialize build executor if needed
      if (!buildExecutor) {
        const BuildExecutor = (await import('./utils/buildExecutor.js')).default;
        buildExecutor = new BuildExecutor(bot);
      }
      
      result = await buildExecutor.buildStructure(
        params.blueprint, 
        params.position, 
        {
          layerByLayer: params.layerByLayer !== false,
          scaffolding: params.scaffolding || false,
          prepareGround: params.prepareGround !== false,
          clearArea: params.clearArea !== false,
          progressCallback: (progress) => {
            if (progress.current % 20 === 0) {
              log(`Build progress: ${progress.current}/${progress.total} (${progress.placed} placed)`);
            }
          }
        }
      );
      break;

    case 'preview_build':
      result = await previewBuild(bot, params);
      break;

    case 'list_schematics':
      result = await listSchematics(bot, params);
      break;
    
    default:
      bot.chat(`Unknown action: ${action}`);
      return { success: false, message: `Unknown action: ${action}` };
  }

  return result;
}

// Process command with AI
async function processInGameCommand(username, commandText) {
  isProcessing = true;
  
  log(`\nProcessing from ${username}: ${commandText}`);
  bot.chat(`🤔 Thinking...`);

  try {
    const context = {
      health: bot.health,
      food: bot.food,
      position: `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`
    };

    log(`📤 Sending to Colab AI...`);
    
    const response = await axios.post(
      `${COLAB_SERVER_URL}/parse`,
      {
        text: commandText,
        context: context,
        playerName: username  // IMPORTANT: Send player name
      },
      { 
        timeout: 50000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status) => status < 600
      }
    );

    log(`📥 Response: ${response.status}`);

    if (response.status !== 200) {
      bot.chat(` AI error: ${response.status}`);
      isProcessing = false;
      return;
    }

    const parsedCommand = response.data;
    log(`📋 Parsed: ${JSON.stringify(parsedCommand)}`);

    if (parsedCommand.error) {
      bot.chat(` ${parsedCommand.error}`);
      isProcessing = false;
      return;
    }

    // Handle multi-step commands
    if (parsedCommand.is_multistep && parsedCommand.steps && parsedCommand.steps.length > 0) {
      logSuccess(`⛓️ Multi-step command: ${parsedCommand.steps.length} steps`);
      bot.chat(`⛓️ Executing ${parsedCommand.steps.length} steps...`);
      
      let stepNum = 1;
      for (const step of parsedCommand.steps) {
        const action = step.action;
        const params = { ...step };
        delete params.action;
        
        log(`\n📍 Step ${stepNum}/${parsedCommand.steps.length}: ${action}`);
        bot.chat(`[${stepNum}/${parsedCommand.steps.length}] ${getActionEmoji(action)} ${getActionDescription(action, params)}...`);
        
        const result = await executeAction(action, params, username);
        
        if (!result.success) {
          bot.chat(`❌ Step ${stepNum} failed: ${result.message || result.error}`);
          logError(`Step ${stepNum} failed`);
          break;
        }
        
        logSuccess(`✅ Step ${stepNum} complete`);
        stepNum++;
        
        // Small delay between steps
        await sleep(500);
      }
      
      bot.chat(`✅ All steps completed!`);
      logSuccess('Multi-step command completed');
      
    } else {
      // Single action
      const { action, params } = parsedCommand;
      
      if (!action) {
        bot.chat(`❓ I'm not sure what to do`);
        isProcessing = false;
        return;
      }

      log(`✅ Single action: ${action}`);
      
      // Don't announce for "respond" action (conversations)
      if (action !== 'respond') {
        bot.chat(`${getActionEmoji(action)} ${getActionDescription(action, params)}...`);
      }
      
      const result = await executeAction(action, params, username);
      
      if (result.success) {
        if (action !== 'respond') {
          bot.chat(`✅ ${result.message || 'Done!'}`);
        }
        logSuccess(`Completed: ${result.message}`);
      } else {
        bot.chat(`❌ ${result.message || result.error}`);
        logError(`Failed: ${result.message || result.error}`);
      }
    }

  } catch (error) {
    logError(`❌ Error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      bot.chat('❌ Cannot reach AI server');
    } else if (error.code === 'ETIMEDOUT') {
      bot.chat('❌ AI timeout, try again');
    } else {
      bot.chat(`❌ Error: ${error.message}`);
    }
  } finally {
    isProcessing = false;
  }
}

function getActionEmoji(action) {
  const emojis = {
    mine: '⛏️',
    fight: '⚔️',
    harvest: '🌾',
    craft: '🔨',
    follow: '🏃',
    give: '🎁',
    navigate: '🗺️',
    respond: '💬',
    smelt: '🔥' ,
    load_blueprint: '🏗️',      
    build_structure: '🏗️',     
    preview_build: '🏗️' 
  };
  return emojis[action] || '⚙️';
}

function getActionDescription(action, params) {
  switch (action) {
    case 'mine':
      return `Mining ${params.count || 1}x ${params.blockType}`;
    case 'fight':
      return `Attacking ${params.mobType || 'mobs'}`;
    case 'harvest':
      return `Harvesting ${params.cropType || 'crops'}`;
    case 'craft':
      return `Crafting ${params.count || 1}x ${params.itemName}`;
    case 'follow':
      return `Following ${params.playerName}`;
    case 'give':
      return `Giving ${params.itemName} to ${params.playerName}`;
    case 'navigate':
      return `Going to ${params.x}, ${params.y}, ${params.z}`;
    case 'smelt':  // ADD THIS
      return `Smelting ${params.count || 1}x ${params.itemName}`;
    case 'load_blueprint':
      return `Loading blueprint: ${params.filePath}`;
    case 'build_structure':
      return `Building structure (${params.blueprint?.totalBlocks || '?'} blocks)`;
    case 'preview_build':
      return `Previewing build`;
    case 'list_schematics':
      return `Listing schematics`;
    default:
      return action;
  }
}

function containsActionKeywords(message) {
  const keywords = [
    'mine', 'dig', 'gather', 'collect', 'get',
    'fight', 'attack', 'kill',
    'harvest', 'farm',
    'follow', 'come',
    'craft', 'make', 'create', 'build',
    'give', 'drop', 'hand',
    'go', 'move', 'travel',
    'how', 'what', 'why', 'who'  // Questions
  ];
  
  const lowerMsg = message.toLowerCase();
  return keywords.some(keyword => lowerMsg.includes(keyword));
}

function showHelp() {
  bot.chat('🤖 I understand natural language!');
  bot.chat('Examples:');
  bot.chat('  "how are you?"');
  bot.chat('  "mine 5 logs and give them to me"');
  bot.chat('  "I need a diamond pickaxe"');
  bot.chat('  "get me some wood"');
  bot.chat('Or use: !mine, !craft, !fight, !harvest');
}

function showStatus() {
  const pos = bot.entity.position;
  bot.chat(`❤️ ${bot.health}/20 | 🍖 ${bot.food}/20`);
  bot.chat(`📍 ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`);
  if (currentAction) bot.chat(`⚙️ ${currentAction}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// REST API (keep existing functionality)
app.post('/command', async (req, res) => {
  const { action, params } = req.body;
  if (!bot) {
    return res.status(503).json({ success: false, error: 'Bot not initialized' });
  }
  try {
    const result = await executeAction(action, params, 'API');
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/status', (req, res) => {
  if (!bot) return res.status(503).json({ error: 'Bot not initialized' });
  res.json({
    connected: bot._client?.state === 'play',
    position: bot.entity?.position,
    health: bot.health,
    food: bot.food,
    currentAction: currentAction,
    processing: isProcessing,
    colabUrl: COLAB_SERVER_URL
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    bot_ready: !!bot,
    colab_url: COLAB_SERVER_URL
  });
});

const PORT = process.env.NODE_PORT || 3000;
app.listen(PORT, async () => {
  logSuccess(`\n🚀 Node.js server on port ${PORT}`);
  log(`🌐 Colab AI: ${COLAB_SERVER_URL}`);
  log(`💬 Advanced NLP enabled!\n`);
  createBot();
});

process.on('SIGINT', () => {
  log('\n👋 Shutting down...');
  if (bot) {
    bot.chat('👋 Goodbye!');
    bot.quit();
  }
  process.exit(0);
});