import minecraftData from 'minecraft-data';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { log, logSuccess, logWarning, logError } from '../utils/logger.js';

/**
 * Enhanced Give function - Auto-gathers items if not in inventory
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { playerName: string, itemName: string, count: number }
 */
export async function give(bot, params) {
  const { playerName, itemName, count } = params;

  if (!playerName) {
    throw new Error('Player name is required');
  }

  const mcData = minecraftData(bot.version);

  // If no specific item, give all items
  if (!itemName) {
    log(`Giving all items to ${playerName}`);
    return await giveItemsToPlayer(bot, playerName, null, null);
  }

  // Normalize item name
  const normalizedName = normalizeItemName(itemName, mcData);
  const item = mcData.itemsByName[normalizedName];

  if (!item) {
    throw new Error(`Unknown item: ${itemName}`);
  }

  // Check how many we have
  const currentCount = bot.inventory.count(item.id);
  const needed = (count || 1);

  log(`Player wants ${needed}x ${normalizedName}`);
  log(`Currently have: ${currentCount}x ${normalizedName}`);

  // If we don't have enough, gather more
  if (currentCount < needed) {
    const toGather = needed - currentCount;
    log(`⚠️ Need to gather ${toGather} more ${normalizedName}`);
    
    try {
      await gatherItemsForGiving(bot, normalizedName, toGather, mcData);
    } catch (error) {
      throw new Error(`Cannot gather ${normalizedName}: ${error.message}`);
    }
  }

  // Now give the items
  log(`Giving ${needed}x ${normalizedName} to ${playerName}`);
  return await giveItemsToPlayer(bot, playerName, normalizedName, needed);
}

/**
 * Gather items by crafting or mining
 */
async function gatherItemsForGiving(bot, itemName, amount, mcData) {
  log(`Gathering ${amount}x ${itemName}...`);

  // Try crafting first
  const recipeManager = await getRecipeManagerForGive(bot);
  if (recipeManager) {
    const recipe = recipeManager.getRecipe(itemName);
    if (recipe) {
      log(`Found recipe for ${itemName}, crafting...`);
      const { craftItem } = await import('./craft.js');
      await craftItem(bot, { itemName, count: amount });
      logSuccess(`Crafted ${amount}x ${itemName}`);
      return;
    }
  }

  // Try mining
  try {
    await mineForGiving(bot, itemName, amount, mcData);
  } catch (error) {
    throw new Error(`Cannot gather ${itemName}: ${error.message}`);
  }
}

/**
 * Mine items for giving
 */
async function mineForGiving(bot, itemName, amount, mcData) {
  const blockMappings = {
    'oak_log': 'oak_log',
    'spruce_log': 'spruce_log',
    'birch_log': 'birch_log',
    'cobblestone': 'stone',
    'stone': 'stone',
    'coal': 'coal_ore',
    'iron_ingot': 'iron_ore',
    'diamond': 'diamond_ore',
    'gold_ingot': 'gold_ore',
    'dirt': 'dirt',
    'sand': 'sand',
    'gravel': 'gravel'
  };

  const blockName = blockMappings[itemName] || itemName;
  const blockData = mcData.blocksByName[blockName];

  if (!blockData) {
    throw new Error(`Cannot mine ${itemName} - no block mapping found`);
  }

  log(`Mining ${amount}x ${blockName} for ${itemName}...`);

  const { mine } = await import('./mine.js');
  await mine(bot, { blockType: blockName, count: amount });
  
  logSuccess(`Mined ${amount}x ${blockName}`);
}

/**
 * Get recipe manager (lazy load)
 */
async function getRecipeManagerForGive(bot) {
  try {
    const { getRecipeManager, initRecipeSystem } = await import('../utils/recipeManager.js');
    let manager = getRecipeManager();
    if (!manager) {
      await initRecipeSystem(bot);
      manager = getRecipeManager();
    }
    return manager;
  } catch (error) {
    logWarning('Recipe manager not available');
    return null;
  }
}

/**
 * Give items to a player
 */
async function giveItemsToPlayer(bot, playerName, itemName = null, count = null) {
  log(`Giving items to ${playerName}`);

  const player = bot.players[playerName]?.entity;
  
  if (!player) {
    throw new Error(`Player ${playerName} not found or not visible`);
  }

  // Navigate close to player
  try {
    const goal = new goals.GoalNear(
      player.position.x, 
      player.position.y, 
      player.position.z, 
      2
    );
    await bot.pathfinder.goto(goal);
    log(`Reached ${playerName}`);
  } catch (error) {
    logWarning(`Could not reach player: ${error.message}`);
  }

  // If specific item requested
  if (itemName) {
    const items = bot.inventory.items().filter(item => 
      item.name === itemName || item.name.includes(itemName)
    );

    if (items.length === 0) {
      throw new Error(`No ${itemName} in inventory to give`);
    }

    let givenCount = 0;
    for (const item of items) {
      const toGive = count ? Math.min(item.count, count - givenCount) : item.count;
      
      try {
        await bot.toss(item.type, null, toGive);
        givenCount += toGive;
        logSuccess(`Dropped ${toGive}x ${item.name} for ${playerName}`);
        
        if (count && givenCount >= count) {
          break;
        }
      } catch (error) {
        logError(`Failed to drop ${item.name}: ${error.message}`);
      }
    }

    return {
      success: true,
      message: `Gave ${givenCount}x ${itemName} to ${playerName}`
    };
  } else {
    // Give all items
    const items = bot.inventory.items();
    let givenCount = 0;
    
    for (const item of items) {
      try {
        await bot.toss(item.type, null, item.count);
        givenCount++;
        log(`Dropped ${item.count}x ${item.name}`);
      } catch (error) {
        logError(`Failed to drop ${item.name}: ${error.message}`);
      }
    }
    
    logSuccess(`Dropped all items (${givenCount} types) for ${playerName}`);
    
    return {
      success: true,
      message: `Gave all items to ${playerName}`
    };
  }
}

/**
 * Normalize item name
 */
function normalizeItemName(itemName, mcData) {
  let normalized = itemName.toLowerCase().trim();
  
  const aliases = {
    'plank': 'oak_planks',
    'planks': 'oak_planks',
    'log': 'oak_log',
    'logs': 'oak_log',
    'wood': 'oak_log',
    'stick': 'stick',
    'sticks': 'stick',
    'cobble': 'cobblestone',
    'rocks': 'cobblestone'
  };
  
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  
  if (mcData.itemsByName[normalized]) {
    return normalized;
  }
  
  // Try removing/adding 's'
  if (normalized.endsWith('s')) {
    const singular = normalized.slice(0, -1);
    if (mcData.itemsByName[singular]) {
      return singular;
    }
  } else {
    const plural = normalized + 's';
    if (mcData.itemsByName[plural]) {
      return plural;
    }
  }
  
  return normalized;
}