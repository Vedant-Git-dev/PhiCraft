import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from '../utils/logger.js';
import { Vec3 } from 'vec3';
import { searchChestsForItem, gatherMissingItems } from '../utils/inventory.js';

/**
 * Craft an item
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { itemName: string, count: number }
 */
export async function craftItem(bot, params) {
  const { itemName, count = 1 } = params;

  log(`Attempting to craft ${count}x ${itemName}`);

  const mcData = minecraftData(bot.version);
  const item = mcData.itemsByName[itemName];

  if (!item) {
    throw new Error(`Unknown item: ${itemName}`);
  }

  // Find recipe
  let recipe = bot.recipesFor(item.id, null, 1, null);
  console.log(recipe);

  if (!recipe[0]) {
   try { 
  
    const craftingTable = await findOrPlaceCraftingTable(bot);
    recipe = bot.recipesFor(item.id, null, 1, craftingTable);
   
  } catch(e) {
  
    logError(`Error finding/placing crafting table: ${e.message}`);

  }

  log(`Found recipe for ${itemName}`);

  // Check if we have materials
  const missingMaterials = checkMaterials(bot, recipe, count);

  if (missingMaterials.length > 0) {
    log(`Missing materials:`);
    missingMaterials.forEach(mat => {
      log(`  - ${mat.name}: need ${mat.needed}, have ${mat.have}`);
    });

    // Try to find in chests
    logWarning(`Searching nearby chests for materials...`);
    for (const material of missingMaterials) {
      const found = await searchChestsForItem(bot, material.name, material.needed - material.have);
      if (found) {
        logSuccess(`Found ${material.name} in chest`);
      }
    }

    // Check again
    const stillMissing = checkMaterials(bot, recipe, count);
    
    if (stillMissing.length > 0) {
      logWarning(`Still missing materials, attempting to gather/craft...`);
      
      for (const material of stillMissing) {
        const gathered = await gatherMissingItems(bot, material.name, material.needed - material.have);
        if (!gathered) {
          throw new Error(`Cannot obtain required material: ${material.name}`);
        }
      }
    }
  }

  // Find crafting table if needed
  // if (recipe.requiresTable) {
  //   const craftingTable = await findOrPlaceCraftingTable(bot);
  //   if (!craftingTable) {
  //     throw new Error('Need crafting table but cannot find or place one');
  //   }
  // }

  // Craft the item
  try {
    let crafted = 0;
    for (let i = 0; i < count; i++) {
      if (recipe.requiresTable) {
        const craftingTable = bot.findBlock({
          matching: mcData.blocksByName.crafting_table.id,
          maxDistance: 32
        });
        await bot.craft(recipe, 1, craftingTable);
      } else {
        await bot.craft(recipe, 1, null);
      }
      crafted++;
      log(`Crafted ${itemName} (${crafted}/${count})`);
    }

    logSuccess(`Successfully crafted ${crafted}x ${itemName}`);
    return {
      success: true,
      crafted,
      message: `Crafted ${crafted}x ${itemName}`
    };

  } catch (error) {
    logError(`Crafting failed: ${error.message}`);
    throw error;
  }
}

/**
 * Check if we have required materials
 */
function checkMaterials(bot, recipe, count) {
  const missing = [];

  for (const ingredient of recipe.delta) {
    if (ingredient.count > 0) continue; // Output, not input

    const needed = Math.abs(ingredient.count) * count;
    const itemName = ingredient.id ? 
      minecraftData(bot.version).items[ingredient.id]?.name : null;

    if (!itemName) continue;

    const have = bot.inventory.count(ingredient.id);

    if (have < needed) {
      missing.push({
        id: ingredient.id,
        name: itemName,
        needed,
        have
      });
    }
  }

  return missing;
}

/**
 * Find or place a crafting table
 */function checkMaterials(bot, recipe, count) {
  const missing = [];
  const mcData = minecraftData(bot.version);
  
  // Prefer ingredients, fallback to delta if needed
  const inputs = recipe.ingredients || recipe.delta || [];

  for (const ingredient of inputs) {
    // Ingredients can be arrays (for “any of these” type recipes)
    const itemChoice = Array.isArray(ingredient) ? ingredient[0] : ingredient;
    if (!itemChoice) continue;

    const needed = itemChoice.count ? itemChoice.count * count : count;
    const itemName = mcData.items[itemChoice.id]?.name;
    if (!itemName) continue;

    const have = bot.inventory.count(itemChoice.id);

    if (have < needed) {
      missing.push({
        id: itemChoice.id,
        name: itemName,
        needed,
        have
      });
    }
  }

  return missing;
}

async function findOrPlaceCraftingTable(bot) {
  const mcData = minecraftData(bot.version);
  
  // Look for nearby crafting table
  let craftingTable = bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id,
    maxDistance: 32
  });

  if (craftingTable) {
    log(`Found crafting table at ${craftingTable.position}`);
    return craftingTable;
  }

  // Try to place one
  log('No crafting table found, attempting to place one...');
  
  const tableItem = bot.inventory.items().find(item => 
    item.name === 'crafting_table'
  );

  if (!tableItem) {
    // Try to craft one
    log('No crafting table in inventory, trying to craft...');
    
    const planks = bot.inventory.items().find(item => 
      item.name.includes('planks')
    );

    if (!planks || planks.count < 4) {
      logWarning('Need 4 planks to craft crafting table');
      return null;
    }

    try {
      const recipe = bot.recipesFor(mcData.itemsByName.crafting_table.id, null, 1, null)[0];
      await bot.craft(recipe, 1, null);
      logSuccess('Crafted crafting table');
    } catch (error) {
      logError(`Failed to craft crafting table: ${error.message}`);
      return null;
    }
  }

  // Place the crafting table
  try {
    const referenceBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    const tableItemNow = bot.inventory.items().find(item => 
      item.name === 'crafting_table'
    );
    
    await bot.equip(tableItemNow, 'hand');
    await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
    
    logSuccess('Placed crafting table');
    
    craftingTable = bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 5
    });
    
    return craftingTable;
  } catch (error) {
    logError(`Failed to place crafting table: ${error.message}`);
    return null;
  }
} 
}