import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import minecraftData from 'minecraft-data';
import { log, logError, logSuccess } from '../utils/logger.js';

/**
 * Mine a specific block type
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

      log(`Found ${blockType} at ${block.position}`);

      // Navigate to block
      const goal = new goals.GoalGetToBlock(
        block.position.x,
        block.position.y,
        block.position.z
      );
      
      await bot.pathfinder.goto(goal);

      // Equip appropriate tool
      await equipBestTool(bot, block);

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
 */
async function equipBestTool(bot, block) {
  const tools = bot.inventory.items().filter(item => {
    return item.name.includes('pickaxe') ||
           item.name.includes('axe') ||
           item.name.includes('shovel');
  });

  if (tools.length === 0) {
    return; // No tools, use hand
  }

  // Find best tool based on block type
  let bestTool = null;
  let bestSpeed = 0;

  for (const tool of tools) {
    const digTime = block.digTime(tool);
    if (digTime > 0 && (bestTool === null || digTime < bestSpeed)) {
      bestTool = tool;
      bestSpeed = digTime;
    }
  }

  if (bestTool) {
    await bot.equip(bestTool, 'hand');
    log(`Equipped ${bestTool.name}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}