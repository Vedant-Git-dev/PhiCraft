import minecraftData from 'minecraft-data';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { Vec3 } from 'vec3';
import { log, logError, logSuccess, logWarning } from './logger.js';

/**
 * Crafting Table Manager - Handles finding, navigating to, and placing crafting tables
 */

/**
 * Find crafting table within range
 */
export function findCraftingTable(bot, maxDistance = 32) {
  const mcData = minecraftData(bot.version);
  
  const table = bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id,
    maxDistance: maxDistance
  });

  if (table) {
    log(`Found crafting table at ${table.position}`);
  }

  return table;
}

/**
 * Navigate to crafting table using pathfinder
 */
export async function navigateToCraftingTable(bot, table, maxAttempts = 2) {
  log(`Navigating to crafting table at ${table.position}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const goal = new goals.GoalGetToBlock(
        table.position.x,
        table.position.y,
        table.position.z
      );
      
      await bot.pathfinder.goto(goal);
      
      // Wait a bit to ensure we're settled
      await sleep(300);
      
      // Verify we're close enough
      const distance = bot.entity.position.distanceTo(table.position);
      
      if (distance <= 4.5) {
        logSuccess(`Reached crafting table (${distance.toFixed(1)} blocks away)`);
        return { success: true, table };
      }
      
      logWarning(`Still ${distance.toFixed(1)} blocks away from table (attempt ${attempt}/${maxAttempts})`);
      
      if (attempt < maxAttempts) {
        log(`Retrying navigation...`);
        await sleep(500);
      }
      
    } catch (error) {
      logWarning(`Navigation attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < maxAttempts) {
        await sleep(500);
      }
    }
  }

  return { success: false, table: null };
}

/**
 * Find and navigate to crafting table, or place a new one
 */
export async function findAndNavigateToCraftingTable(bot, mcData) {
  // Try to find existing table
  const existingTable = findCraftingTable(bot, 32);

  if (existingTable) {
    const navResult = await navigateToCraftingTable(bot, existingTable);
    
    if (navResult.success) {
      return existingTable;
    }
    
    logWarning(`Could not reach existing crafting table, will place a new one`);
  } else {
    log('No crafting table found nearby');
  }

  // Place a new crafting table
  return await placeCraftingTable(bot, mcData);
}

/**
 * Check if bot has crafting table in inventory
 */
export function hasCraftingTableInInventory(bot) {
  const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  return tableItem !== undefined;
}

/**
 * Craft a crafting table
 */
export async function craftCraftingTable(bot, mcData) {
  log('Crafting crafting table...');

  // Need 4 planks
  const planks = bot.inventory.items().find(i => i.name.includes('planks'));
  
  if (!planks || planks.count < 4) {
    // Try to get planks from logs
    const hasPlanks = await craftPlanksFromLogs(bot, mcData);
    
    if (!hasPlanks) {
      throw new Error('Need 4 planks (or logs) to craft crafting table');
    }
  }

  // Craft crafting table (2x2 grid, no table needed)
  const tableRecipe = bot.recipesFor(mcData.itemsByName.crafting_table.id, null, null, null);
  
  if (!tableRecipe || tableRecipe.length === 0) {
    throw new Error('Cannot find crafting table recipe');
  }

  await bot.craft(tableRecipe[0], 1, null);
  logSuccess('Crafted crafting table');
  
  return true;
}

/**
 * Craft planks from logs
 */
async function craftPlanksFromLogs(bot, mcData) {
  const logs = bot.inventory.items().find(i => 
    i.name.includes('log') && !i.name.includes('stripped')
  );

  if (!logs) {
    logWarning('No logs available to craft planks');
    return false;
  }

  log(`Crafting planks from ${logs.name}...`);

  // Get planks item (try oak first, then any planks)
  let planksItem = mcData.itemsByName['oak_planks'];
  
  if (!planksItem) {
    // Find any planks item
    for (const itemName in mcData.itemsByName) {
      if (itemName.includes('planks')) {
        planksItem = mcData.itemsByName[itemName];
        break;
      }
    }
  }

  if (!planksItem) {
    logError('Cannot find planks item in minecraft data');
    return false;
  }

  const planksRecipe = bot.recipesFor(planksItem.id, null, null, null);
  
  if (!planksRecipe || planksRecipe.length === 0) {
    logError('Cannot find planks recipe');
    return false;
  }

  // Craft planks (2x2, no table needed)
  await bot.craft(planksRecipe[0], 1, null);
  logSuccess('Crafted planks from logs');
  
  return true;
}

/**
 * Place crafting table near bot
 */
export async function placeCraftingTable(bot, mcData) {
  log('Placing crafting table...');

  // Ensure we have a crafting table
  if (!hasCraftingTableInInventory(bot)) {
    await craftCraftingTable(bot, mcData);
  }

  // Get table from inventory
  const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  
  if (!tableItem) {
    throw new Error('No crafting table in inventory after crafting');
  }

  // Find a good position to place it
  const playerPos = bot.entity.position;
  const positions = [
    playerPos.offset(1, 0, 0),   // East
    playerPos.offset(-1, 0, 0),  // West
    playerPos.offset(0, 0, 1),   // South
    playerPos.offset(0, 0, -1),  // North
    playerPos.offset(1, 0, 1),   // SE
    playerPos.offset(-1, 0, 1),  // SW
    playerPos.offset(1, 0, -1),  // NE
    playerPos.offset(-1, 0, -1), // NW
    playerPos.offset(2, 0, 0),   // Far East
    playerPos.offset(-2, 0, 0)   // Far West
  ];

  let placed = false;

  for (const pos of positions) {
    try {
      // Check if position is empty (air)
      const targetBlock = bot.blockAt(pos);
      if (targetBlock && targetBlock.name !== 'air') {
        continue; // Position occupied
      }

      // Check if there's a solid block below
      const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
      if (!blockBelow || blockBelow.name === 'air' || !blockBelow.boundingBox || blockBelow.boundingBox === 'empty') {
        continue; // No solid ground
      }

      // Try to place here
      await bot.equip(tableItem, 'hand');
      await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
      
      logSuccess(`Placed crafting table at (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`);
      placed = true;
      break;

    } catch (err) {
      // Try next position
      continue;
    }
  }

  if (!placed) {
    throw new Error('Could not find valid position to place crafting table');
  }

  // Wait for block to register
  await sleep(500);

  // Find the placed table
  const table = bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id,
    maxDistance: 5
  });

  if (!table) {
    throw new Error('Placed table but cannot find it');
  }

  logSuccess(`Crafting table ready at ${table.position}`);
  return table;
}

/**
 * Ensure crafting table is available and accessible
 */
export async function ensureCraftingTableAccess(bot, mcData) {
  log('Ensuring crafting table access...');
  
  try {
    const table = await findAndNavigateToCraftingTable(bot, mcData);
    
    if (!table) {
      throw new Error('Could not get crafting table access');
    }
    
    // Verify we're actually close enough
    const distance = bot.entity.position.distanceTo(table.position);
    
    if (distance > 4.5) {
      logWarning(`Table is ${distance.toFixed(1)} blocks away, might be out of reach`);
    }
    
    return table;
    
  } catch (error) {
    logError(`Failed to ensure crafting table access: ${error.message}`);
    throw error;
  }
}

/**
 * Utility sleep function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  findCraftingTable,
  navigateToCraftingTable,
  findAndNavigateToCraftingTable,
  hasCraftingTableInInventory,
  craftCraftingTable,
  placeCraftingTable,
  ensureCraftingTableAccess
};