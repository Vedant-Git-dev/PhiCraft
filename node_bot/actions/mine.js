import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from '../utils/logger.js';

/**
 * Mine a specific block type with proper tool validation
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { blockType: string, count: number }
 */
export async function mine(bot, params) {
  const { blockType = 'stone', count = 1 } = params;

  log(`Starting to mine ${count} ${blockType} block(s)`);

  const mcData = minecraftData(bot.version);
  const blockId = mcData.blocksByName[blockType]?.id;

  if (!blockId) {
    throw new Error(`Unknown block type: ${blockType}`);
  }

  let minedCount = 0;

  for (let i = 0; i < count; i++) {
    try {
      // Find nearest block of the specified type
      const block = bot.findBlock({
        matching: blockId,
        maxDistance: 64
      });

      if (!block) {
        logError(`No ${blockType} blocks found nearby`);
        break;
      }

      // Equip appropriate tool BEFORE mining
      await equipBestToolForBlock(bot, block, blockType);

      log(`Found ${blockType} at ${block.position}`);

      // Navigate to block
      const goal = new goals.GoalGetToBlock(
        block.position.x,
        block.position.y,
        block.position.z
      );
      
      await bot.pathfinder.goto(goal);

      await equipBestToolForBlock(bot, block, blockType);

      // Mine the block
      await bot.dig(block);
      minedCount++;
      logSuccess(`Mined ${blockType} (${minedCount}/${count})`);

      // Small delay between mining
      await sleep(500);

    } catch (error) {
      logError(`Mining error: ${error.message}`);
      break;
    }
  }

  return {
    success: true,
    minedCount,
    message: `Mined ${minedCount}/${count} ${blockType} blocks`
  };
}

/**
 * Equip the best tool for mining a block
 * ENHANCED: Uses tool validator to check requirements
 */
async function equipBestToolForBlock(bot, block, blockType) {
  log(`\n=== TOOL SELECTION FOR ${blockType} ===`);
  
  // Import tool validator
  let toolValidator;
  try {
    toolValidator = await import('../utils/toolValidator.js');
  } catch (error) {
    logWarning('Tool validator not available, using basic tool selection');
    return await equipBestToolBasic(bot, block);
  }

  // List all tools in inventory for debugging
  log('Current inventory tools:');
  toolValidator.listInventoryTools(bot);

  // Check what tool we need
  const requirement = toolValidator.getRequiredToolTier(blockType);
  log(`Block requirement: ${requirement.tier} ${requirement.tool} or better`);

  // Check if we have adequate tool
  const toolCheck = toolValidator.hasAdequateTool(bot, blockType);
  
  let getTool;

  if (!toolCheck.hasTooling) {
    logError(` Missing required tool: ${toolCheck.requiredTool}`);
    getTool = await import('./craft.js');
    log(`Attempting to craft ${toolCheck.requiredTool}...`);
    
    try {
      await getTool.craftItem(bot, { itemName: toolCheck.requiredTool, count: 1 });
      logSuccess(`Crafted ${toolCheck.requiredTool}`);
    } catch (error) {
      logError(`Failed to craft ${toolCheck.requiredTool}: ${error.message}`);
    }
  }

  // Get the best tool
  const bestTool = toolValidator.getBestToolForBlock(bot, blockType);
  
  if (bestTool) {
    try {
      await bot.equip(bestTool, 'hand');
      logSuccess(`✓ Equipped: ${bestTool.name}`);
      log(`===========================\n`);
    } catch (error) {
      logError(`Failed to equip ${bestTool.name}: ${error.message}`);
    }
  } else {
    log(`Using hand (no tool required)`);
    log(`===========================\n`);
  }
}

/**
 * Fallback: Basic tool selection without validator
 */
async function equipBestToolBasic(bot, block) {
  const tools = bot.inventory.items().filter(item => {
    return item.name.includes('pickaxe') ||
           item.name.includes('axe') ||
           item.name.includes('shovel');
  });

  if (tools.length === 0) {
    log('No tools found, using hand');
    return;
  }

  // Find best tool based on block dig time
  let bestTool = null;
  let bestSpeed = Infinity;

  for (const tool of tools) {
    try {
      const digTime = block.digTime(tool);
      if (digTime > 0 && digTime < bestSpeed) {
        bestTool = tool;
        bestSpeed = digTime;
      }
    } catch (error) {
      // Ignore errors for invalid tools
      continue;
    }
  }

  if (bestTool) {
    await bot.equip(bestTool, 'hand');
    log(`Equipped ${bestTool.name} (dig time: ${bestSpeed.toFixed(2)}s)`);
  } else {
    log('No suitable tool found, using hand');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}