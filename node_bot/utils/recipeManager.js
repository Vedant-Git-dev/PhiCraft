import minecraftData from 'minecraft-data';
import { log, logWarning } from './logger.js';

/**
 * Recipe Manager - Handles all recipe database operations
 */
class RecipeManager {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
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
      const recipeData = this.mcData.recipes;
      
      if (!recipeData) {
        logWarning('No recipe data in minecraft-data');
        this.initialized = true;
        return;
      }

      // Index recipes by item name
      for (const recipeId in recipeData) {
        const recipe = recipeData[recipeId][0];
        if (recipe.result && recipe.result.id) {
          const item = this.mcData.items[recipe.result.id];
          if (item) {
            if (!this.recipesByName[item.name]) {
              this.recipesByName[item.name] = [];
            }
            this.recipesByName[item.name].push(recipe);
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

  /**
   * Check if recipe needs crafting table
   */
  needsCraftingTable(recipe) {
    if (recipe.inShape && recipe.inShape.length > 2) {
      return true;
    }
    if (recipe.inShape && recipe.inShape.some(row => row.length > 2)) {
      return true;
    }
    return false;
  }
}

// Global recipe manager instance
let recipeManagerInstance = null;

/**
 * Initialize recipe manager
 */
export async function initRecipeSystem(bot) {
  if (!recipeManagerInstance) {
    recipeManagerInstance = new RecipeManager(bot);
    await recipeManagerInstance.initialize();
  }
  return recipeManagerInstance;
}

/**
 * Get recipe manager instance
 */
export function getRecipeManager() {
  return recipeManagerInstance;
}

/**
 * Normalize item name (handle aliases and plurals)
 */
export function normalizeItemName(itemName, mcData) {
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
    'shovel': 'wooden_shovel',
    'spade': 'wooden_shovel'
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

export default RecipeManager;