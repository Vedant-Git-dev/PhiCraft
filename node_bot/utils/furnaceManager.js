import minecraftData from 'minecraft-data';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { Vec3 } from 'vec3';
import { log, logError, logSuccess, logWarning } from './logger.js';

/**
 * Furnace Manager - Handles furnace finding, crafting, and placement
 */

class FurnaceManager {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
  }

  /**
   * Find nearest furnace in the world
   */
  findFurnace(maxDistance = 32) {
    const furnaceBlock = this.bot.findBlock({
      matching: this.mcData.blocksByName.furnace.id,
      maxDistance: maxDistance
    });

    if (furnaceBlock) {
      log(`Found furnace at ${furnaceBlock.position}`);
      return furnaceBlock;
    }

    return null;
  }

  /**
   * Navigate to a furnace
   */
  async navigateToFurnace(furnaceBlock, maxAttempts = 2) {
    log(`Navigating to furnace at ${furnaceBlock.position}...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const goal = new goals.GoalGetToBlock(
          furnaceBlock.position.x,
          furnaceBlock.position.y,
          furnaceBlock.position.z
        );
        
        await this.bot.pathfinder.goto(goal);
        
        await this.sleep(300);
        
        const distance = this.bot.entity.position.distanceTo(furnaceBlock.position);
        
        if (distance <= 4.5) {
          logSuccess(`Reached furnace (${distance.toFixed(1)} blocks away)`);
          return { success: true };
        }
        
        logWarning(`Still ${distance.toFixed(1)} blocks from furnace (attempt ${attempt}/${maxAttempts})`);
        
        if (attempt < maxAttempts) {
          await this.sleep(500);
        }
        
      } catch (error) {
        logWarning(`Navigation attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxAttempts) {
          await this.sleep(500);
        }
      }
    }

    return { success: false };
  }

  /**
   * Check if bot has furnace in inventory
   */
  hasFurnaceInInventory() {
    const furnaceItem = this.bot.inventory.items().find(i => i.name === 'furnace');
    return furnaceItem !== undefined;
  }

  /**
   * Craft a furnace (requires 8 cobblestone)
   */
  async craftFurnace() {
    log('Crafting furnace...');

    // Check if we have 8 cobblestone
    const cobblestoneItem = this.mcData.itemsByName.cobblestone;
    const cobblestoneCount = this.bot.inventory.count(cobblestoneItem.id);

    if (cobblestoneCount < 8) {
      const needed = 8 - cobblestoneCount;
      log(`Need ${needed} more cobblestone`);
      
      // Gather cobblestone
      await this.gatherCobblestone(needed);
    }

    // Craft furnace (requires crafting table)
    const furnaceRecipe = this.bot.recipesFor(this.mcData.itemsByName.furnace.id, null, null, null);
    
    if (!furnaceRecipe || furnaceRecipe.length === 0) {
      // Need crafting table
      const { ensureCraftingTableAccess } = await import('./craftingTableManager.js');
      const table = await ensureCraftingTableAccess(this.bot, this.mcData);
      
      const furnaceRecipeWithTable = this.bot.recipesFor(this.mcData.itemsByName.furnace.id, null, null, table);
      
      if (!furnaceRecipeWithTable || furnaceRecipeWithTable.length === 0) {
        throw new Error('Cannot find furnace recipe');
      }
      
      await this.bot.craft(furnaceRecipeWithTable[0], 1, table);
    } else {
      await this.bot.craft(furnaceRecipe[0], 1, null);
    }

    logSuccess('Crafted furnace');
    return true;
  }

  /**
   * Gather cobblestone by mining stone
   */
  async gatherCobblestone(amount) {
    log(`Gathering ${amount} cobblestone...`);

    const stoneBlock = this.mcData.blocksByName.stone;
    
    if (!stoneBlock) {
      throw new Error('Stone block not found in minecraft data');
    }

    // Import and use mine action
    const { mine } = await import('../actions/mine.js');
    await mine(this.bot, { blockType: 'stone', count: amount });

    logSuccess(`Gathered ${amount} cobblestone`);
  }

  /**
   * Place furnace near the bot
   */
  async placeFurnace() {
    log('Placing furnace...');

    // Ensure we have a furnace
    if (!this.hasFurnaceInInventory()) {
      await this.craftFurnace();
    }

    const furnaceItem = this.bot.inventory.items().find(i => i.name === 'furnace');
    
    if (!furnaceItem) {
      throw new Error('No furnace in inventory after crafting');
    }

    // Find a good position to place it
    const playerPos = this.bot.entity.position;
    const positions = [
      playerPos.offset(1, 0, 0),
      playerPos.offset(-1, 0, 0),
      playerPos.offset(0, 0, 1),
      playerPos.offset(0, 0, -1),
      playerPos.offset(1, 0, 1),
      playerPos.offset(-1, 0, 1),
      playerPos.offset(1, 0, -1),
      playerPos.offset(-1, 0, -1),
      playerPos.offset(2, 0, 0),
      playerPos.offset(-2, 0, 0)
    ];

    let placed = false;

    for (const pos of positions) {
      try {
        const targetBlock = this.bot.blockAt(pos);
        if (targetBlock && targetBlock.name !== 'air') {
          continue;
        }

        const blockBelow = this.bot.blockAt(pos.offset(0, -1, 0));
        if (!blockBelow || blockBelow.name === 'air' || !blockBelow.boundingBox || blockBelow.boundingBox === 'empty') {
          continue;
        }

        await this.bot.equip(furnaceItem, 'hand');
        await this.bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
        
        logSuccess(`Placed furnace at (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`);
        placed = true;
        break;

      } catch (err) {
        continue;
      }
    }

    if (!placed) {
      throw new Error('Could not find valid position to place furnace');
    }

    await this.sleep(500);

    const furnaceBlock = this.bot.findBlock({
      matching: this.mcData.blocksByName.furnace.id,
      maxDistance: 5
    });

    if (!furnaceBlock) {
      throw new Error('Placed furnace but cannot find it');
    }

    logSuccess(`Furnace ready at ${furnaceBlock.position}`);
    return furnaceBlock;
  }

  /**
   * Ensure furnace is available and accessible
   */
  async ensureFurnaceAccess() {
    log('Ensuring furnace access...');
    
    // Try to find existing furnace
    let furnaceBlock = this.findFurnace(32);

    if (furnaceBlock) {
      const navResult = await this.navigateToFurnace(furnaceBlock);
      
      if (navResult.success) {
        return furnaceBlock;
      }
      
      logWarning('Could not reach existing furnace, placing a new one');
    } else {
      log('No furnace found nearby');
    }

    // Place a new furnace
    furnaceBlock = await this.placeFurnace();
    return furnaceBlock;
  }

  /**
   * Open furnace and return furnace interface
   */
  async openFurnace(furnaceBlock) {
    log('Opening furnace...');

    try {
      const furnace = await this.bot.openFurnace(furnaceBlock);
      logSuccess('Furnace opened');
      return furnace;
    } catch (error) {
      logError(`Failed to open furnace: ${error.message}`);
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default FurnaceManager;