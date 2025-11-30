/**
 * Intelligent Crafting Chain System
 * Automatically gathers/crafts required materials
 */

import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from './logger.js';
import { mine } from '../actions/mine.js';
import { harvest } from '../actions/harvest.js';

class CraftingChain {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
    this.craftingRecipes = this.initializeRecipes();
    this.gatheringMethods = this.initializeGatheringMethods();
  }

  /**
   * Get all items needed to craft an item
   * Recursively resolves crafting chains
   */
  async getRequiredItems(itemName, quantity = 1) {
    log(`🔍 Analyzing crafting chain for ${quantity}x ${itemName}`);

    const required = {};
    const visited = new Set();

    const resolve = async (item, count) => {
      if (visited.has(item)) return;
      visited.add(item);

      const recipe = this.craftingRecipes[item];

      if (!recipe) {
        // Base item - need to gather it
        required[item] = (required[item] || 0) + count;
        return;
      }

      // Recursive - add ingredients
      for (const ingredient of recipe.ingredients) {
        const neededAmount = ingredient.count * count;
        await resolve(ingredient.item, neededAmount);
      }
    };

    await resolve(itemName, quantity);

    log(`📋 Required items: ${JSON.stringify(required)}`);
    return required;
  }

  /**
   * Execute full crafting chain
   */
  async executeCraftingChain(itemName, quantity = 1) {
    try {
      log(`⛓️ Starting crafting chain for ${quantity}x ${itemName}`);

      // Get required items
      const required = await this.getRequiredItems(itemName, quantity);

      // Check inventory
      const inventory = this.getInventorySummary();
      const missing = {};

      for (const [item, needed] of Object.entries(required)) {
        const have = inventory[item] || 0;
        if (have < needed) {
          missing[item] = needed - have;
        }
      }

      // Gather missing items
      if (Object.keys(missing).length > 0) {
        logWarning(`Missing items: ${JSON.stringify(missing)}`);

        for (const [item, needed] of Object.entries(missing)) {
          await this.gatherItem(item, needed);
        }
      }

      // Craft the final item
      await this.craftItem(itemName, quantity);

      logSuccess(`Crafted ${quantity}x ${itemName}`);
      return {
        success: true,
        message: `Successfully crafted ${quantity}x ${itemName}`
      };

    } catch (error) {
      logError(`Crafting chain failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Gather a specific item
   */
  async gatherItem(itemName, quantity) {
    log(`📦 Gathering ${quantity}x ${itemName}`);

    const method = this.gatheringMethods[itemName];

    if (!method) {
      throw new Error(`Don't know how to gather ${itemName}`);
    }

    switch (method.type) {
      case 'mine':
        return await mine(this.bot, {
          blockType: method.blockName,
          count: quantity
        });

      case 'harvest':
        return await harvest(this.bot, {
          cropType: method.cropName,
          radius: 32
        });

      case 'craft':
        return await this.executeCraftingChain(itemName, quantity);

      case 'hunt':
        return await this.huntItem(itemName, quantity, method);

      default:
        throw new Error(`Unknown gathering method for ${itemName}`);
    }
  }

  /**
   * Hunt animals for items
   */
  async huntItem(itemName, quantity, method) {
    log(`🏹 Hunting for ${itemName}`);

    const { mobType, drops } = method;
    const itemsPerMob = drops[itemName] || 1;
    const mobsNeeded = Math.ceil(quantity / itemsPerMob);

    // Use fight action
    const { fight } = await import('../actions/fight.js');

    for (let i = 0; i < mobsNeeded; i++) {
      const result = await fight(this.bot, {
        mobType: mobType,
        radius: 32
      });

      if (!result.success) {
        throw new Error(`Could not hunt ${mobType}`);
      }

      // Check if we have enough
      const currentAmount = this.bot.inventory.count(
        this.mcData.itemsByName[itemName]?.id
      );

      if (currentAmount >= quantity) break;
    }

    return { success: true };
  }

  /**
   * Craft an item directly
   */
  async craftItem(itemName, quantity) {
    log(`🔨 Crafting ${quantity}x ${itemName}`);

    const { craftItem } = await import('../actions/craft.js');

    return await craftItem(this.bot, {
      itemName: itemName,
      count: quantity
    });
  }

  /**
   * Get current inventory summary
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
   * Check if we can craft an item
   */
  canCraft(itemName) {
    const recipe = this.craftingRecipes[itemName];
    if (!recipe) return false;

    for (const ingredient of recipe.ingredients) {
      const have = this.bot.inventory.count(
        this.mcData.itemsByName[ingredient.item]?.id
      );

      if (have < ingredient.count) {
        return false;
      }
    }

    return true;
  }

  /**
   * Initialize crafting recipes
   */
  initializeRecipes() {
    return {
      'diamond_pickaxe': {
        ingredients: [
          { item: 'diamond', count: 3 },
          { item: 'stick', count: 2 }
        ],
        requiresTable: true
      },
      'iron_pickaxe': {
        ingredients: [
          { item: 'iron_ingot', count: 3 },
          { item: 'stick', count: 2 }
        ],
        requiresTable: true
      },
      'stone_pickaxe': {
        ingredients: [
          { item: 'stone', count: 3 },
          { item: 'stick', count: 2 }
        ],
        requiresTable: true
      },
      'iron_sword': {
        ingredients: [
          { item: 'iron_ingot', count: 2 },
          { item: 'stick', count: 1 }
        ],
        requiresTable: true
      },
      'diamond_sword': {
        ingredients: [
          { item: 'diamond', count: 2 },
          { item: 'stick', count: 1 }
        ],
        requiresTable: true
      },
      'chest': {
        ingredients: [
          { item: 'oak_planks', count: 8 }
        ],
        requiresTable: true
      },
      'crafting_table': {
        ingredients: [
          { item: 'oak_planks', count: 4 }
        ],
        requiresTable: false
      },
      'furnace': {
        ingredients: [
          { item: 'cobblestone', count: 8 }
        ],
        requiresTable: true
      },
      'stick': {
        ingredients: [
          { item: 'oak_planks', count: 2 }
        ],
        requiresTable: false
      },
      'oak_planks': {
        ingredients: [
          { item: 'oak_log', count: 1 }
        ],
        requiresTable: false
      },
      'torch': {
        ingredients: [
          { item: 'stick', count: 1 },
          { item: 'charcoal', count: 1 }
        ],
        requiresTable: false
      },
      'bed': {
        ingredients: [
          { item: 'oak_planks', count: 3 },
          { item: 'wool', count: 3 }
        ],
        requiresTable: true
      }
    };
  }

  /**
   * Initialize gathering methods
   */
  initializeGatheringMethods() {
    return {
      // Mining
      'diamond': {
        type: 'mine',
        blockName: 'diamond_ore'
      },
      'iron_ingot': {
        type: 'craft',
        requires: 'iron_ore'
      },
      'iron_ore': {
        type: 'mine',
        blockName: 'iron_ore'
      },
      'gold_ingot': {
        type: 'craft',
        requires: 'gold_ore'
      },
      'gold_ore': {
        type: 'mine',
        blockName: 'gold_ore'
      },
      'coal': {
        type: 'mine',
        blockName: 'coal_ore'
      },
      'stone': {
        type: 'mine',
        blockName: 'stone'
      },
      'cobblestone': {
        type: 'mine',
        blockName: 'stone'
      },
      'dirt': {
        type: 'mine',
        blockName: 'dirt'
      },
      'sand': {
        type: 'mine',
        blockName: 'sand'
      },
      'gravel': {
        type: 'mine',
        blockName: 'gravel'
      },

      // Logging
      'oak_log': {
        type: 'mine',
        blockName: 'oak_log'
      },
      'birch_log': {
        type: 'mine',
        blockName: 'birch_log'
      },
      'spruce_log': {
        type: 'mine',
        blockName: 'spruce_log'
      },

      // Farming
      'wheat': {
        type: 'harvest',
        cropName: 'wheat'
      },
      'carrots': {
        type: 'harvest',
        cropName: 'carrots'
      },
      'potatoes': {
        type: 'harvest',
        cropName: 'potatoes'
      },
      'beetroot': {
        type: 'harvest',
        cropName: 'beetroots'
      },

      // Hunting
      'pork': {
        type: 'hunt',
        mobType: 'pig',
        drops: { 'pork': 1 }
      },
      'beef': {
        type: 'hunt',
        mobType: 'cow',
        drops: { 'beef': 1 }
      },
      'wool': {
        type: 'hunt',
        mobType: 'sheep',
        drops: { 'wool': 1 }
      },

      // Crafting
      'oak_planks': {
        type: 'craft'
      },
      'stick': {
        type: 'craft'
      },
      'crafting_table': {
        type: 'craft'
      }
    };
  }
}

export default CraftingChain;