import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import minecraftData from 'minecraft-data';
import { log, logError, logSuccess } from '../utils/logger.js';

/**
 * Harvest crops and replant
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { cropType: string, radius: number }
 */
export async function harvest(bot, params) {
  const { cropType = 'wheat', radius = 32 } = params;

  log(`Starting harvest (crop: ${cropType}, radius: ${radius})`);

  const mcData = minecraftData(bot.version);
  const cropBlockName = getCropBlockName(cropType);
  const blockId = mcData.blocksByName[cropBlockName]?.id;

  if (!blockId) {
    throw new Error(`Unknown crop type: ${cropType}`);
  }

  let harvestedCount = 0;

  // Find all mature crops
  const crops = bot.findBlocks({
    matching: blockId,
    maxDistance: radius,
    count: 1000
  });

  log(`Found ${crops.length} ${cropType} plants`);

  for (const cropPos of crops) {
    try {
      const block = bot.blockAt(cropPos);
      
      if (!block) continue;

      // Check if crop is mature
      if (!isCropMature(block, cropType)) {
        continue;
      }

      // Navigate to crop
      const goal = new goals.GoalGetToBlock(
        block.position.x,
        block.position.y,
        block.position.z
      );
      
      await bot.pathfinder.goto(goal);

      // Harvest
      await bot.dig(block);
      harvestedCount++;
      logSuccess(`Harvested ${cropType} (${harvestedCount})`);

      // Replant
      await replant(bot, block.position, cropType);

      await sleep(200);

    } catch (error) {
      logError(`Harvest error: ${error.message}`);
    }
  }

  return {
    success: true,
    harvestedCount,
    message: `Harvested ${harvestedCount} ${cropType} plants`
  };
}

/**
 * Get the block name for a crop type
 */
function getCropBlockName(cropType) {
  const mapping = {
    wheat: 'wheat',
    carrots: 'carrots',
    potatoes: 'potatoes',
    beetroots: 'beetroots',
    melon: 'melon',
    pumpkin: 'pumpkin'
  };
  return mapping[cropType] || cropType;
}

/**
 * Check if crop is fully grown
 */
function isCropMature(block, cropType) {
  // Most crops are mature at age 7
  if (block.metadata === 7) return true;
  
  // Melons and pumpkins are always harvestable
  if (cropType === 'melon' || cropType === 'pumpkin') {
    return true;
  }

  return false;
}

/**
 * Replant crop after harvesting
 */
async function replant(bot, position, cropType) {
  try {
    const seedMapping = {
      wheat: 'wheat_seeds',
      carrots: 'carrot',
      potatoes: 'potato',
      beetroots: 'beetroot_seeds'
    };

    const seedName = seedMapping[cropType];
    if (!seedName) return;

    // Find seeds in inventory
    const seeds = bot.inventory.items().find(item => 
      item.name === seedName
    );

    if (!seeds) {
      log(`No ${seedName} to replant`);
      return;
    }

    // Place the seed
    const farmlandBlock = bot.blockAt(position.offset(0, -1, 0));
    
    if (farmlandBlock && farmlandBlock.name === 'farmland') {
      await bot.equip(seeds, 'hand');
      await bot.placeBlock(farmlandBlock, new bot.vec3(0, 1, 0));
      log(`Replanted ${cropType}`);
    }

  } catch (error) {
    // Replanting failed, not critical
    log(`Could not replant: ${error.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}