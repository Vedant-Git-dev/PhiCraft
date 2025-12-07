import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from '../utils/logger.js';
import { initRecipeSystem, getRecipeManager, normalizeItemName } from '../utils/recipeManager.js';
import { hasAdequateTool, logToolRequirement } from '../utils/toolValidator.js';
import { ensureCraftingTableAccess } from '../utils/craftingTableManager.js';
import { isSmeltable, getSmeltingInput } from '../utils/smeltingRecipes.js';
import SmeltingManager from '../utils/smeltingManager.js';

/**
 * Main craft function - orchestrates the crafting process
 * NOW WITH SMELTING INTEGRATION
 */
export async function craftItem(bot, params) {
  const { itemName, count = 1 } = params;
  const mcData = minecraftData(bot.version);

  // Initialize recipe system if not already done
  let recipeManager = getRecipeManager();
  if (!recipeManager) {
    await initRecipeSystem(bot);
    recipeManager = getRecipeManager();
  }

  log(`Attempting to craft ${count}x ${itemName}`);

  // Normalize item name
  const normalizedName = normalizeItemName(itemName, mcData);
  const item = mcData.itemsByName[normalizedName];

  if (!item) {
    throw new Error(`Unknown item: ${itemName}`);
  }

  log(`Item: ${normalizedName}`);

  // Check if this item needs smelting instead of crafting
  if (isSmeltable(normalizedName)) {
    log(`${normalizedName} requires smelting, not crafting`);
    const smeltingManager = new SmeltingManager(bot);
    return await smeltingManager.smeltItem(normalizedName, count);
  }

  // Get recipe from database
  const recipe = recipeManager.getRecipe(normalizedName);
  
  if (!recipe) {
    throw new Error(`No recipe found for ${normalizedName}`);
  }

  log(`Found recipe in database`);

  // Get ingredients
  const ingredients = recipeManager.getIngredients(recipe);
  log(`Ingredients needed: ${JSON.stringify(ingredients)}`);

  // Gather all required materials (with smelting support)
  for (const [ingName, ingCount] of Object.entries(ingredients)) {
    await gatherMaterial(bot, ingName, ingCount * count, mcData);
  }

  // Check if we need a crafting table
  let table = null;
  const needsTable = recipeManager.needsCraftingTable(recipe);
  
  if (needsTable) {
    log('Recipe requires crafting table');
    table = await ensureCraftingTableAccess(bot, mcData);
  }

  // Perform crafting
  let crafted = 0;
  const itemId = item.id;

  try {
    // Get bot's recipe object (now that we have materials)
    const botRecipes = bot.recipesFor(itemId, null, null, table);
    
    if (!botRecipes || botRecipes.length === 0) {
      throw new Error(`Bot cannot find recipe even with materials`);
    }

    const botRecipe = botRecipes[0];

    // Craft the items
    for (let i = 0; i < count; i++) {
      await bot.craft(botRecipe, 1, table);
      crafted++;
      log(`Crafted ${normalizedName} (${crafted}/${count})`);
      await sleep(100);
    }

  } catch (error) {
    logError(`Craft error: ${error.message}`);
    
    if (crafted === 0) {
      throw error;
    }
  }

  logSuccess(`Successfully crafted ${crafted}x ${normalizedName}`);
  return {
    success: true,
    crafted,
    message: `Crafted ${crafted}x ${normalizedName}`
  };
}

/**
 * Gather material - either craft it, smelt it, or mine it
 * ENHANCED WITH SMELTING SUPPORT
 */
async function gatherMaterial(bot, itemName, amount, mcData) {
  const item = mcData.itemsByName[itemName];
  if (!item) {
    throw new Error(`Unknown material: ${itemName}`);
  }

  const have = bot.inventory.count(item.id);
  
  if (have >= amount) {
    log(`Already have ${have}x ${itemName}`);
    return;
  }

  const needed = amount - have;
  log(`Need ${needed}x ${itemName} (have ${have})`);

  // Check if this material requires smelting
  if (isSmeltable(itemName)) {
    log(`${itemName} requires smelting`);
    const smeltingManager = new SmeltingManager(bot);
    await smeltingManager.smeltItem(itemName, needed);
    return;
  }

  // Check if we can craft it
  const recipeManager = getRecipeManager();
  if (recipeManager) {
    const recipe = recipeManager.getRecipe(itemName);
    if (recipe) {
      log(`Can craft ${itemName}`);
      await craftItem(bot, { itemName, count: needed });
      return;
    }
  }

  // Try to mine it
  await mineForItem(bot, itemName, needed, mcData);
}

/**
 * Mine for an item with tool validation
 */
async function mineForItem(bot, itemName, amount, mcData) {
  // Block mappings for items that come from mining
  const blockMappings = {
    'oak_log': 'oak_log',
    'spruce_log': 'spruce_log',
    'birch_log': 'birch_log',
    'jungle_log': 'jungle_log',
    'acacia_log': 'acacia_log',
    'dark_oak_log': 'dark_oak_log',
    'cobblestone': 'stone',
    'coal': 'coal_ore',
    'raw_iron': 'iron_ore',
    'raw_gold': 'gold_ore',
    'raw_copper': 'copper_ore',
    'iron_ore': 'iron_ore',
    'gold_ore': 'gold_ore',
    'copper_ore': 'copper_ore',
    'diamond': 'diamond_ore',
    'redstone': 'redstone_ore',
    'emerald': 'emerald_ore',
    'lapis_lazuli': 'lapis_ore',
    'dirt': 'dirt',
    'sand': 'sand',
    'gravel': 'gravel',
    'stick': null,
    'oak_planks': null,
    'planks': null
  };

  const blockName = blockMappings[itemName];
  
  if (blockName === null) {
    throw new Error(`Cannot mine ${itemName} - must be crafted`);
  }

  const blockToMine = blockName || itemName;
  const blockData = mcData.blocksByName[blockToMine];

  if (!blockData) {
    throw new Error(`Unknown block: ${blockToMine}`);
  }

  // Log tool requirement
  logToolRequirement(blockToMine);

  // Validate tool requirement
  const toolCheck = hasAdequateTool(bot, blockToMine);
  
  if (!toolCheck.hasTooling) {
    log(`Need ${toolCheck.requiredTool} to mine ${blockToMine}`);
    log(`Attempting to craft ${toolCheck.requiredTool}...`);
    
    try {
      // Recursively craft the required tool
      await craftItem(bot, { 
        itemName: toolCheck.requiredTool, 
        count: 1 
      });
      logSuccess(`Crafted ${toolCheck.requiredTool}`);
      
      // Re-check after crafting
      const recheckTool = hasAdequateTool(bot, blockToMine);
      if (!recheckTool.hasTooling) {
        throw new Error(`Still cannot mine ${blockToMine} after crafting tool`);
      }
      
    } catch (error) {
      throw new Error(`Cannot mine ${blockToMine} - need ${toolCheck.requiredTool} but failed to craft it: ${error.message}`);
    }
  } else {
    log(`Have adequate tool: ${toolCheck.toolName}`);
  }

  // Find the block
  const block = bot.findBlock({
    matching: blockData.id,
    maxDistance: 64
  });

  if (!block) {
    throw new Error(`No ${blockToMine} found nearby`);
  }

  log(`Mining ${amount}x ${blockToMine}`);
  
  // Use the mine action
  const { mine } = await import('./mine.js');
  await mine(bot, { blockType: blockToMine, count: amount });
}

/**
 * Utility sleep function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for use by other modules
export { initRecipeSystem };