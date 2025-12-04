import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from './logger.js';
import { craftItem } from '../actions/craft.js';

/**
 * Efficient crafting chain - uses bot.recipesFor() properly
 */
class CraftingChain {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
  }

  /**
   * Execute crafting chain with smart material gathering
   */
  async executeCraftingChain(itemName, quantity = 1) {
    try {
      log(`⛓️ Crafting chain: ${quantity}x ${itemName}`);

      // Use the smart craft function which handles everything
      const result = await craftItem(this.bot, {
        itemName,
        count: quantity
      });

      return result;

    } catch (error) {
      logError(`Crafting chain failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: error.message
      };
    }
  }

  /**
   * Get inventory summary
   */
  getInventorySummary() {
    const summary = {};
    const items = this.bot.inventory.items();

    for (const item of items) {
      summary[item.name] = (summary[item.name] || 0) + item.count;
    }

    return summary;
  }

  /**
   * Check if bot can craft an item
   */
  canCraft(itemName) {
    const item = this.mcData.itemsByName[itemName];
    if (!item) return false;

    // Check for recipe without requiring materials
    const recipes = this.bot.recipesFor(item.id, null, null, null);
    if (recipes && recipes.length > 0) return true;

    // Check with crafting table
    const table = this.bot.findBlock({
      matching: this.mcData.blocksByName.crafting_table?.id,
      maxDistance: 32
    });

    if (table) {
      const recipesWithTable = this.bot.recipesFor(item.id, null, null, table);
      return recipesWithTable && recipesWithTable.length > 0;
    }

    return false;
  }

  /**
   * Get recipe ingredients (for planning)
   */
  getRecipeIngredients(itemName) {
    const item = this.mcData.itemsByName[itemName];
    if (!item) return null;

    // Get recipe
    let recipe = this.bot.recipesFor(item.id, null, null, null)[0];
    
    if (!recipe) {
      const table = this.bot.findBlock({
        matching: this.mcData.blocksByName.crafting_table?.id,
        maxDistance: 32
      });
      
      if (table) {
        recipe = this.bot.recipesFor(item.id, null, null, table)[0];
      }
    }

    if (!recipe) return null;

    const ingredients = {};

    // Parse ingredients
    if (recipe.delta) {
      for (const item of recipe.delta) {
        if (item.count < 0) {
          const itemData = this.mcData.items[item.id];
          if (itemData) {
            ingredients[itemData.name] = Math.abs(item.count);
          }
        }
      }
    }

    if (recipe.ingredients) {
      for (const ingredient of recipe.ingredients) {
        const item = Array.isArray(ingredient) ? ingredient[0] : ingredient;
        if (item && item.id) {
          const itemData = this.mcData.items[item.id];
          if (itemData) {
            ingredients[itemData.name] = item.count || 1;
          }
        }
      }
    }

    return ingredients;
  }
}

export default CraftingChain;