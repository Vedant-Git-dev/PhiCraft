import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from '../utils/logger.js';
import { Vec3 } from 'vec3';
import loadRecipes from "prismarine-recipe";

/**
 * Recipe system using prismarine-recipe to load ALL recipes at startup
 * Doesn't require materials to see recipes!
 */

class RecipeManager {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
    this.recipes = null;
    this.recipesByName = {};
    this.initialized = false;
  }

  /**
   * Load all recipes from minecraft-data
   */
  async initialize() {
    if (this.initialized) return;

    log('Loading recipe database...');

    try {
      // // Load recipe system
      // const Recipe = loadRecipes("1.8");
      
      // Get all recipes from minecraft-data
      const recipeData = this.mcData.recipes;
      
      if (!recipeData) {
        logWarning('No recipe data in minecraft-data');
        this.initialized = true;
        return;
      }
      // Index recipes by item name
       for (const recipeId in recipeData) {
        const recipe = recipeData[recipeId];
        if (recipe[0].result && recipe[0].result.id) {
          const item = this.mcData.items[recipe[0].result.id];
          if (item) {
            if (!this.recipesByName[item.name]) {
              this.recipesByName[item.name] = [];
            }
            this.recipesByName[item.name].push(recipe[0]);
          }
        }
      }

      log(`Loaded ${Object.keys(this.recipesByName).length} recipe types`);
      this.initialized = true;

    } catch (error) {
      logWarning(`Could not load recipe database: ${error.message}`);
      this.initialized = true;
    }
  }

  /**
   * Get recipe for item (no materials needed!)
   */
  getRecipe(itemName) {
    if (!this.initialized) {
      logWarning('Recipe manager not initialized');
      return null;
    }

    const recipes = this.recipesByName[itemName];
    if (!recipes || recipes.length === 0) {
      return null;
    }

    return recipes[0]; // Return first recipe
  }

  /**
   * Get ingredients from recipe
   */
  getIngredients(recipe) {
    const ingredients = {};

    if (recipe.inShape) {
      // Shaped recipe
      for (const row of recipe.inShape) {
        for (const itemId of row) {
          if (itemId && itemId > 0) {
            const item = this.mcData.items[itemId];
            if (item) {
              ingredients[item.name] = (ingredients[item.name] || 0) + 1;
            }
          }
        }
      }
    } else if (recipe.ingredients) {
      // Shapeless recipe
      for (const itemId of recipe.ingredients) {
        if (itemId && itemId > 0) {
          const item = this.mcData.items[itemId];
          if (item) {
            ingredients[item.name] = (ingredients[item.name] || 0) + 1;
          }
        }
      }
    }

    return ingredients;
  }
}

// Global recipe manager
let recipeManager = null;

/**
 * Initialize recipe manager
 */
export async function initRecipeSystem(bot) {
  recipeManager = new RecipeManager(bot);
  await recipeManager.initialize();
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
    'stick': 'stick',
    'sticks': 'stick',
    'pickaxe': 'wooden_pickaxe',
    'pick': 'wooden_pickaxe',
    'sword': 'wooden_sword',
    'axe': 'wooden_axe',
    'shovel': 'wooden_shovel'
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

/**
 * Main craft function using recipe database
 */
export async function craftItem(bot, params) {
  const { itemName, count = 1 } = params;
  const mcData = minecraftData(bot.version);

  if (!recipeManager) {
    await initRecipeSystem(bot);
  }

  log(`Attempting to craft ${count}x ${itemName}`);

  // Normalize name
  const normalizedName = normalizeItemName(itemName, mcData);
  const item = mcData.itemsByName[normalizedName];

  if (!item) {
    throw new Error(`Unknown item: ${itemName}`);
  }

  log(`Item: ${normalizedName}`);

  // Get recipe from database (NO MATERIALS NEEDED!)
  const recipe = recipeManager.getRecipe(normalizedName);
  
  if (!recipe) {
    // Fallback to bot's recipe system
    return await craftWithBotRecipe(bot, normalizedName, count, item, mcData);
  }

  log(`Found recipe in database`);

  // Get ingredients
  const ingredients = recipeManager.getIngredients(recipe);
  log(`Ingredients needed: ${JSON.stringify(ingredients)}`);

  // Gather materials
  for (const [ingName, ingCount] of Object.entries(ingredients)) {
    await gatherMaterial(bot, ingName, ingCount * count, mcData);
  }

  // Check if need crafting table
  let table = null;
  if (recipe.inShape && recipe.inShape.length > 2) {
    table = await findOrPlaceCraftingTable(bot, mcData);
  }

  // Now use bot.craft() with the actual recipe
  let crafted = 0;
  let id = mcData.itemsByName[item.name].id;

  try {
    // Get the bot's recipe object now that we have materials
    const botRecipes = bot.recipesFor(id, null, null, table);
    
    if (!botRecipes || botRecipes.length === 0) {
      throw new Error(`Bot cannot find recipe even with materials`);
    }

    const botRecipe = botRecipes[0];

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
 * Fallback to bot recipe system
 */
async function craftWithBotRecipe(bot, itemName, count, item, mcData) {
  log(`Using bot recipe system for ${itemName}`);

  let table = await findOrPlaceCraftingTable(bot, mcData);
  const recipes = bot.recipesFor(item.id, null, null, table);

  if (!recipes || recipes.length === 0) {
    throw new Error(`No recipe found for ${itemName}`);
  }

  const recipe = recipes[0];
  let crafted = 0;

  for (let i = 0; i < count; i++) {
    try {
      await bot.craft(recipe, 1, table);
      crafted++;
      await sleep(100);
    } catch (err) {
      logError(`Craft failed: ${err.message}`);
      break;
    }
  }

  return {
    success: crafted > 0,
    crafted,
    message: crafted > 0 ? `Crafted ${crafted}x ${itemName}` : `Failed to craft ${itemName}`
  };
}

/**
 * Gather material (craft or mine)
 */
async function gatherMaterial(bot, itemName, amount, mcData) {
  const item = mcData.itemsByName[itemName];
  if (!item) {
    throw new Error(`Unknown material: ${itemName}`);
  }

  const have = bot.inventory.count(item.id);
  
  if (have >= amount) {
    log(`✓ Have ${have}x ${itemName}`);
    return;
  }

  const needed = amount - have;
  log(`Need ${needed}x ${itemName} (have ${have})`);

  // Check if we can craft it
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
 * Mine for an item
 */
async function mineForItem(bot, itemName, amount, mcData) {
  const blockMappings = {
    'oak_log': 'oak_log',
    'spruce_log': 'spruce_log',
    'birch_log': 'birch_log',
    'cobblestone': 'stone',
    'coal': 'coal_ore',
    'iron_ingot': 'iron_ore',
    'diamond': 'diamond_ore',
    'stick': null, // Must craft
    'oak_planks': null // Must craft
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

  const block = bot.findBlock({
    matching: blockData.id,
    maxDistance: 64
  });

  if (!block) {
    throw new Error(`No ${blockToMine} found nearby`);
  }

  log(`Mining ${amount}x ${blockToMine}`);
  
  const { mine } = await import('./mine.js');
  await mine(bot, { blockType: blockToMine, count: amount });
}

/**
 * Find or place crafting table
 */
async function findOrPlaceCraftingTable(bot, mcData) {
  let table = bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id,
    maxDistance: 32
  });

  if (table) {
    return table;
  }

  log('Placing crafting table...');

  // Check inventory
  let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');

  if (!tableItem) {
    // Craft one
    log('Crafting crafting table...');
    
    // Need 4 planks
    const planks = bot.inventory.items().find(i => i.name.includes('planks'));
    
    if (!planks || planks.count < 4) {
      // Make planks
      const logs = bot.inventory.items().find(i => 
        i.name.includes('log') && !i.name.includes('stripped')
      );

      if (!logs) {
        throw new Error('Need logs for crafting table');
      }

      // Craft planks from logs
      await gatherMaterial(bot, 'oak_planks', 4, mcData);
    }

    // Craft table
    if (recipeManager) {
      await craftItem(bot, { itemName: 'crafting_table', count: 1 });
    }
  }

  // Place it
  try {
    tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) throw new Error('No table');

    const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    await bot.equip(tableItem, 'hand');
    await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
    
    await sleep(500);
    
    table = bot.findBlock({
      matching: mcData.blocksByName.crafting_table.id,
      maxDistance: 5
    });

    if (table) {
      logSuccess('Placed crafting table');
    }

    return table;

  } catch (err) {
    logError(`Failed to place table: ${err.message}`);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}