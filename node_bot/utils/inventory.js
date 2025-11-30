import minecraftData from 'minecraft-data';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { log, logError, logSuccess, logWarning } from './logger.js';

/**
 * Search nearby chests for an item
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} itemName - Item to search for
 * @param {number} count - How many needed
 * @returns {boolean} - True if found and taken
 */
export async function searchChestsForItem(bot, itemName, count) {
  const mcData = minecraftData(bot.version);
  
  log(`Searching chests for ${count}x ${itemName}`);

  // Find nearby chests
  const chests = bot.findBlocks({
    matching: (block) => {
      return block && (
        block.name === 'chest' ||
        block.name === 'barrel' ||
        block.name === 'trapped_chest'
      );
    },
    maxDistance: 32,
    count: 20
  });

  if (chests.length === 0) {
    log('No chests found nearby');
    return false;
  }

  log(`Found ${chests.length} chests to search`);

  let collected = 0;

  for (const chestPos of chests) {
    try {
      const chestBlock = bot.blockAt(chestPos);
      
      if (!chestBlock) continue;

      // Navigate to chest
      const goal = new goals.GoalGetToBlock(chestPos.x, chestPos.y, chestPos.z);
      await bot.pathfinder.goto(goal);

      // Open chest
      const chest = await bot.openContainer(chestBlock);

      // Search for item
      const itemId = mcData.itemsByName[itemName]?.id;
      if (!itemId) {
        chest.close();
        continue;
      }

      const items = chest.containerItems();
      
      for (const item of items) {
        if (item.type === itemId && collected < count) {
          const toTake = Math.min(item.count, count - collected);
          await chest.withdraw(item.type, null, toTake);
          collected += toTake;
          log(`Took ${toTake}x ${itemName} from chest (${collected}/${count})`);

          if (collected >= count) break;
        }
      }

      chest.close();

      if (collected >= count) {
        logSuccess(`Collected ${collected}x ${itemName} from chests`);
        return true;
      }

    } catch (error) {
      logWarning(`Could not access chest: ${error.message}`);
      continue;
    }
  }

  if (collected > 0) {
    log(`Collected ${collected}x ${itemName} but need ${count}`);
  }

  return collected >= count;
}

/**
 * Gather missing items (mine, chop, or craft)
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} itemName - Item to gather
 * @param {number} count - How many needed
 * @returns {boolean} - True if successfully gathered
 */
export async function gatherMissingItems(bot, itemName, count) {
  log(`Attempting to gather ${count}x ${itemName}`);

  const mcData = minecraftData(bot.version);
  
  // Check if we can mine it
  const blockName = itemName.replace('_ore', '').replace('_log', '');
  const possibleBlocks = [
    itemName,
    `${blockName}_ore`,
    `${blockName}_log`,
    `deepslate_${blockName}_ore`
  ];

  for (const blockType of possibleBlocks) {
    const blockId = mcData.blocksByName[blockType]?.id;
    if (!blockId) continue;

    const block = bot.findBlock({
      matching: blockId,
      maxDistance: 64
    });

    if (block) {
      log(`Found ${blockType} nearby, mining...`);
      
      try {
        // Import mine function
        const { mine } = await import('../actions/mine.js');
        const result = await mine(bot, { blockType, count });
        
        if (result.success && result.minedCount > 0) {
          return true;
        }
      } catch (error) {
        logWarning(`Failed to mine ${blockType}: ${error.message}`);
      }
    }
  }

  // Check if we can craft it
  try {
    const itemId = mcData.itemsByName[itemName]?.id;
    if (itemId) {
      const recipe = bot.recipesFor(itemId, null, 1, null)[0];
      
      if (recipe) {
        log(`Found recipe for ${itemName}, attempting to craft...`);
        
        const { craftItem } = await import('../actions/craft.js');
        const result = await craftItem(bot, { itemName, count });
        
        if (result.success) {
          return true;
        }
      }
    }
  } catch (error) {
    logWarning(`Failed to craft ${itemName}: ${error.message}`);
  }

  // Check if it's a derivative item (e.g., planks from logs)
  if (itemName.includes('planks')) {
    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];
    
    for (const logType of logTypes) {
      const logItem = bot.inventory.items().find(item => item.name === logType);
      
      if (logItem) {
        log(`Converting ${logType} to planks...`);
        
        try {
          const planksRecipe = bot.recipesFor(mcData.itemsByName[itemName].id, null, 1, null)[0];
          if (planksRecipe) {
            const craftCount = Math.ceil(count / 4); // 1 log = 4 planks
            await bot.craft(planksRecipe, craftCount, null);
            logSuccess(`Crafted planks from ${logType}`);
            return true;
          }
        } catch (error) {
          continue;
        }
      }
    }
    
    // Try to get logs
    log('Need logs for planks, searching for trees...');
    const logGathered = await gatherMissingItems(bot, 'oak_log', Math.ceil(count / 4));
    if (logGathered) {
      return await gatherMissingItems(bot, itemName, count);
    }
  }

  // Check if it's sticks (common crafting material)
  if (itemName === 'stick') {
    const planksTypes = bot.inventory.items().filter(item => item.name.includes('planks'));
    
    if (planksTypes.length > 0) {
      log('Crafting sticks from planks...');
      try {
        const sticksRecipe = bot.recipesFor(mcData.itemsByName.stick.id, null, 1, null)[0];
        if (sticksRecipe) {
          const craftCount = Math.ceil(count / 4); // 2 planks = 4 sticks
          await bot.craft(sticksRecipe, craftCount, null);
          logSuccess('Crafted sticks');
          return true;
        }
      } catch (error) {
        logWarning(`Failed to craft sticks: ${error.message}`);
      }
    }
  }

  logError(`Could not gather ${itemName}`);
  return false;
}

/**
 * Give items to a player
 * @param {Object} bot - Mineflayer bot instance
 * @param {string} playerName - Player to give items to
 * @param {string} itemName - Item to give (optional, gives all if not specified)
 * @param {number} count - How many to give
 */
export async function giveItemsToPlayer(bot, playerName, itemName = null, count = null) {
  log(`Giving items to ${playerName}`);

  const player = bot.players[playerName]?.entity;
  
  if (!player) {
    throw new Error(`Player ${playerName} not found`);
  }

  // Navigate close to player
  const goal = new goals.GoalNear(player.position.x, player.position.y, player.position.z, 1);
  await bot.pathfinder.goto(goal);

  // If specific item requested
  if (itemName) {
    const items = bot.inventory.items().filter(item => 
      item.name === itemName || item.name.includes(itemName)
    );

    if (items.length === 0) {
      throw new Error(`No ${itemName} in inventory`);
    }

    for (const item of items) {
      const toGive = count ? Math.min(item.count, count) : item.count;
      
      try {
        await bot.toss(item.type, null, toGive);
        logSuccess(`Dropped ${toGive}x ${item.name} for ${playerName}`);
        
        if (count) {
          count -= toGive;
          if (count <= 0) break;
        }
      } catch (error) {
        logError(`Failed to drop ${item.name}: ${error.message}`);
      }
    }
  } else {
    // Give all items
    const items = bot.inventory.items();
    
    for (const item of items) {
      try {
        await bot.toss(item.type, null, item.count);
        log(`Dropped ${item.count}x ${item.name}`);
      } catch (error) {
        logError(`Failed to drop ${item.name}: ${error.message}`);
      }
    }
    
    logSuccess(`Dropped all items for ${playerName}`);
  }

  return {
    success: true,
    message: `Items given to ${playerName}`
  };
}