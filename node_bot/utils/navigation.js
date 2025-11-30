import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import minecraftData from 'minecraft-data';
import { log, logError, logSuccess } from './logger.js';

/**
 * Navigate to specific coordinates
 * @param {Object} bot - Mineflayer bot instance
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 */
export async function navigateTo(bot, x, y, z) {
  log(`Navigating to (${x}, ${y}, ${z})`);

  const goal = new goals.GoalBlock(x, y, z);
  
  try {
    await bot.pathfinder.goto(goal);
    logSuccess(`Reached destination (${x}, ${y}, ${z})`);
    
    return {
      success: true,
      message: `Arrived at coordinates`
    };
  } catch (error) {
    logError(`Navigation failed: ${error.message}`);
    
    return {
      success: false,
      message: `Could not reach destination: ${error.message}`
    };
  }
}

/**
 * Navigate to nearest block of type
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} blockType - Block name
 */
export async function navigateToBlock(bot, blockType) {
  const mcData = minecraftData(bot.version);
  const blockId = mcData.blocksByName[blockType]?.id;

  if (!blockId) {
    throw new Error(`Unknown block type: ${blockType}`);
  }

  log(`Looking for nearest ${blockType}`);

  const block = bot.findBlock({
    matching: blockId,
    maxDistance: 64
  });

  if (!block) {
    throw new Error(`No ${blockType} found nearby`);
  }

  return navigateTo(bot, block.position.x, block.position.y, block.position.z);
}

/**
 * Calculate distance to coordinates
 */
export function calculateDistance(bot, x, y, z) {
  const pos = bot.entity.position;
  const dx = pos.x - x;
  const dy = pos.y - y;
  const dz = pos.z - z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Get safe position (not in lava/void)
 */
export function isSafePosition(bot, position) {
  const block = bot.blockAt(position);
  if (!block) return false;

  const dangerousBlocks = ['lava', 'fire', 'magma_block', 'cactus'];
  return !dangerousBlocks.includes(block.name);
}