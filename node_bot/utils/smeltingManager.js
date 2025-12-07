import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from './logger.js';
import FurnaceManager from './furnaceManager.js';
import {
  isSmeltable,
  getSmeltingInput,
  getAllSmeltingInputs,
  isFuel,
  getFuelValue,
  calculateFuelNeeded,
  FUEL_PRIORITY
} from './smeltingRecipes.js';

/**
 * Smelting Manager - Handles all smelting operations
 */

class SmeltingManager {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
    this.furnaceManager = new FurnaceManager(bot);
    this.currentFurnaceBlock = null; // Store furnace reference
  }

  /**
   * Main smelting function - fully recursive and autonomous
   */
  async smeltItem(itemName, amount = 1) {
    log(`\n=== SMELTING REQUEST: ${amount}x ${itemName} ===`);

    // Step 1: Validate that item is smeltable
    if (!isSmeltable(itemName)) {
      throw new Error(`${itemName} is not a smeltable item`);
    }

    // Step 2: Get required input materials
    const inputItem = getSmeltingInput(itemName);
    log(`Smelting recipe: ${inputItem} -> ${itemName}`);

    // Step 3: Ensure we have furnace access FIRST (before gathering materials)
    log('Setting up furnace first...');
    this.currentFurnaceBlock = await this.furnaceManager.ensureFurnaceAccess();
    log(`Furnace ready at ${this.currentFurnaceBlock.position}`);

    // Step 4: Ensure we have input materials
    await this.ensureInputMaterials(inputItem, amount);

    // Step 5: Return to furnace after gathering input
    log('Returning to furnace after gathering input materials...');
    await this.returnToFurnace();

    // Step 6: Ensure we have fuel
    await this.ensureFuel(amount);

    // Step 7: Return to furnace after gathering fuel
    log('Returning to furnace after gathering fuel...');
    await this.returnToFurnace();

    // Step 8: Perform smelting
    const result = await this.performSmelting(this.currentFurnaceBlock, inputItem, itemName, amount);

    logSuccess(`\n=== SMELTING COMPLETE: ${result.smelted}x ${itemName} ===\n`);

    return {
      success: true,
      smelted: result.smelted,
      item: itemName,
      message: `Smelted ${result.smelted}x ${itemName}`
    };
  }

  /**
   * Return to the stored furnace location
   */
  async returnToFurnace() {
    if (!this.currentFurnaceBlock) {
      logWarning('No furnace reference stored, finding furnace...');
      this.currentFurnaceBlock = await this.furnaceManager.ensureFurnaceAccess();
      return;
    }

    // Check if furnace still exists at that position
    const furnaceAtPos = this.bot.blockAt(this.currentFurnaceBlock.position);
    
    if (!furnaceAtPos || furnaceAtPos.name !== 'furnace') {
      logWarning('Furnace no longer exists at stored position, finding new one...');
      this.currentFurnaceBlock = await this.furnaceManager.ensureFurnaceAccess();
      return;
    }

    // Navigate back to furnace
    const distance = this.bot.entity.position.distanceTo(this.currentFurnaceBlock.position);
    
    if (distance > 4.5) {
      log(`Navigating back to furnace (${distance.toFixed(1)} blocks away)...`);
      const navResult = await this.furnaceManager.navigateToFurnace(this.currentFurnaceBlock);
      
      if (!navResult.success) {
        logWarning('Could not navigate back to furnace, finding alternative...');
        this.currentFurnaceBlock = await this.furnaceManager.ensureFurnaceAccess();
      }
    } else {
      log(`Already near furnace (${distance.toFixed(1)} blocks)`);
    }
  }

  /**
   * Ensure we have required input materials
   */
  async ensureInputMaterials(inputItem, amount) {
    const mcItem = this.mcData.itemsByName[inputItem];
    
    if (!mcItem) {
      throw new Error(`Unknown input item: ${inputItem}`);
    }

    const currentCount = this.bot.inventory.count(mcItem.id);
    log(`Input check: have ${currentCount}/${amount} ${inputItem}`);

    if (currentCount >= amount) {
      log(`Already have sufficient ${inputItem}`);
      return;
    }

    const needed = amount - currentCount;
    log(`Need to gather ${needed} more ${inputItem}`);

    // Try to gather the input material
    await this.gatherInputMaterial(inputItem, needed);
  }

  /**
   * Gather input material (mine or craft)
   */
  async gatherInputMaterial(itemName, amount) {
    log(`Gathering ${amount}x ${itemName}...`);

    // Check if we can mine it
    const blockMappings = {
      'raw_iron': 'iron_ore',
      'raw_gold': 'gold_ore',
      'raw_copper': 'copper_ore',
      'iron_ore': 'iron_ore',
      'gold_ore': 'gold_ore',
      'copper_ore': 'copper_ore',
      'sand': 'sand',
      'stone': 'stone',
      'netherrack': 'netherrack',
      'clay': 'clay',
      'ancient_debris': 'ancient_debris'
    };

    const blockToMine = blockMappings[itemName];

    if (blockToMine) {
      log(`Mining ${amount}x ${blockToMine} for ${itemName}`);
      const { mine } = await import('../actions/mine.js');
      await mine(this.bot, { blockType: blockToMine, count: amount });
      logSuccess(`Gathered ${amount}x ${itemName}`);
      return;
    }

    // Try to get logs for charcoal
    if (itemName.includes('_log')) {
      const { mine } = await import('../actions/mine.js');
      await mine(this.bot, { blockType: itemName, count: amount });
      logSuccess(`Gathered ${amount}x ${itemName}`);
      return;
    }

    throw new Error(`Cannot gather ${itemName} - no mining method available`);
  }

  /**
   * Ensure we have fuel for smelting
   */
  async ensureFuel(itemCount) {
    log(`Checking fuel for smelting ${itemCount} items...`);

    // Find best available fuel
    const bestFuel = this.getBestAvailableFuel();

    if (bestFuel) {
      const fuelNeeded = calculateFuelNeeded(bestFuel.name, itemCount);
      log(`Best fuel: ${bestFuel.name} (have ${bestFuel.count}, need ${fuelNeeded})`);

      if (bestFuel.count >= fuelNeeded) {
        log(`Sufficient fuel available`);
        return;
      }

      const needed = fuelNeeded - bestFuel.count;
      log(`Need ${needed} more ${bestFuel.name}`);

      // Try to gather more of this fuel
      await this.gatherFuel(bestFuel.name, needed);
      return;
    }

    // No fuel at all - gather default fuel (coal or logs)
    log('No fuel found, gathering coal or wood...');
    await this.gatherDefaultFuel(itemCount);
  }

  /**
   * Get best available fuel from inventory
   */
  getBestAvailableFuel() {
    const inventory = this.bot.inventory.items();

    for (const fuelName of FUEL_PRIORITY) {
      const fuelItem = inventory.find(item => item.name === fuelName);
      if (fuelItem) {
        return {
          name: fuelItem.name,
          count: fuelItem.count,
          item: fuelItem
        };
      }
    }

    // Check for any fuel we haven't listed
    for (const item of inventory) {
      if (isFuel(item.name)) {
        return {
          name: item.name,
          count: item.count,
          item: item
        };
      }
    }

    return null;
  }

  /**
   * Gather specific fuel
   */
  async gatherFuel(fuelName, amount) {
    log(`Gathering ${amount}x ${fuelName}...`);

    // Coal
    if (fuelName === 'coal') {
      const { mine } = await import('../actions/mine.js');
      await mine(this.bot, { blockType: 'coal_ore', count: amount });
      logSuccess(`Gathered ${amount}x coal`);
      return;
    }

    // Charcoal - need to smelt logs
    if (fuelName === 'charcoal') {
      // This is recursive! We need fuel to make fuel
      // Use logs as initial fuel
      await this.gatherFuel('oak_log', Math.ceil(amount / 2));
      // Return to furnace before smelting charcoal
      await this.returnToFurnace();
      // Now smelt logs to charcoal using logs as fuel
      log('Smelting logs to charcoal for fuel...');
      await this.smeltItem('charcoal', amount);
      return;
    }

    // Logs
    if (fuelName.includes('_log')) {
      const { mine } = await import('../actions/mine.js');
      await mine(this.bot, { blockType: fuelName, count: amount });
      logSuccess(`Gathered ${amount}x ${fuelName}`);
      return;
    }

    // Planks - craft from logs
    if (fuelName.includes('_planks')) {
      const logsNeeded = Math.ceil(amount / 4); // 1 log = 4 planks
      await this.gatherFuel('oak_log', logsNeeded);
      
      const { craftItem } = await import('../actions/craft.js');
      await craftItem(this.bot, { itemName: fuelName, count: amount });
      logSuccess(`Crafted ${amount}x ${fuelName}`);
      return;
    }

    // Sticks - craft from planks
    if (fuelName === 'stick') {
      const planksNeeded = Math.ceil(amount / 4); // 2 planks = 4 sticks
      await this.gatherFuel('oak_planks', planksNeeded);
      
      const { craftItem } = await import('../actions/craft.js');
      await craftItem(this.bot, { itemName: 'stick', count: amount });
      logSuccess(`Crafted ${amount}x sticks`);
      return;
    }

    throw new Error(`Cannot gather fuel: ${fuelName}`);
  }

  /**
   * Gather default fuel (coal or wood)
   */
  async gatherDefaultFuel(itemCount) {
    // Try coal first
    const coalOre = this.bot.findBlock({
      matching: this.mcData.blocksByName.coal_ore?.id,
      maxDistance: 64
    });

    if (coalOre) {
      const coalNeeded = calculateFuelNeeded('coal', itemCount);
      await this.gatherFuel('coal', Math.max(1, coalNeeded));
      return;
    }

    // Fall back to wood
    log('No coal nearby, using wood as fuel');
    const logsNeeded = Math.ceil(itemCount / 2); // Conservative estimate
    await this.gatherFuel('oak_log', Math.max(2, logsNeeded));
  }

  /**
   * Perform the actual smelting operation
   */
  async performSmelting(furnaceBlock, inputItem, outputItem, amount) {
    log(`\n=== STARTING SMELTING OPERATION ===`);
    log(`Input: ${amount}x ${inputItem}`);
    log(`Output: ${outputItem}`);

    // Ensure we're at the furnace
    const distance = this.bot.entity.position.distanceTo(furnaceBlock.position);
    if (distance > 4.5) {
      log(`Too far from furnace (${distance.toFixed(1)} blocks), navigating...`);
      await this.returnToFurnace();
    }

    // Open furnace
    const furnace = await this.furnaceManager.openFurnace(furnaceBlock);

    try {
      // Get items from inventory
      const input = this.bot.inventory.items().find(i => i.name === inputItem);
      if (!input) {
        throw new Error(`No ${inputItem} in inventory`);
      }

      // Get best fuel
      const bestFuel = this.getBestAvailableFuel();
      if (!bestFuel) {
        throw new Error('No fuel available');
      }

      const fuelNeeded = calculateFuelNeeded(bestFuel.name, amount);
      const fuelToUse = Math.min(fuelNeeded, bestFuel.count);

      log(`Using ${fuelToUse}x ${bestFuel.name} as fuel`);

      // Put input into furnace
      await furnace.putInput(input.type, null, amount);
      log(`Inserted ${amount}x ${inputItem} into furnace`);

      // Put fuel into furnace
      await furnace.putFuel(bestFuel.item.type, null, fuelToUse);
      log(`Inserted ${fuelToUse}x ${bestFuel.name} as fuel`);

      // Wait for smelting to complete
      const result = await this.waitForSmelting(furnace, amount);

      // Take output
      const outputMcItem = this.mcData.itemsByName[outputItem];
      const outputSlot = furnace.outputItem();

      if (outputSlot) {
        await furnace.takeOutput();
        log(`Retrieved ${outputSlot.count}x ${outputItem}`);
      }

      // Close furnace
      furnace.close();

      return {
        smelted: result.smelted
      };

    } catch (error) {
      // Make sure to close furnace on error
      try {
        furnace.close();
      } catch (e) {
        // Ignore close errors
      }
      throw error;
    }
  }

  /**
   * Wait for smelting to complete
   */
  async waitForSmelting(furnace, expectedCount) {
    log('Waiting for smelting to complete...');

    return new Promise((resolve, reject) => {
      let smeltedCount = 0;
      let updateTimeout = null;
      let completionTimeout = null;

      // Set overall timeout (max 5 minutes)
      const maxTimeout = setTimeout(() => {
        cleanup();
        reject(new Error('Smelting timeout - took too long'));
      }, 300000);

      const cleanup = () => {
        if (updateTimeout) clearTimeout(updateTimeout);
        if (completionTimeout) clearTimeout(completionTimeout);
        clearTimeout(maxTimeout);
        furnace.removeAllListeners('update');
      };

      furnace.on('update', () => {
        const outputSlot = furnace.outputItem();
        const currentCount = outputSlot ? outputSlot.count : 0;

        if (currentCount > smeltedCount) {
          smeltedCount = currentCount;
          log(`Smelting progress: ${smeltedCount}/${expectedCount}`);
        }

        // Reset inactivity timeout
        if (updateTimeout) clearTimeout(updateTimeout);
        
        // If we've smelted everything we need
        if (smeltedCount >= expectedCount) {
          if (completionTimeout) clearTimeout(completionTimeout);
          
          // Wait a bit to ensure it's done
          completionTimeout = setTimeout(() => {
            cleanup();
            logSuccess(`Smelting complete: ${smeltedCount}/${expectedCount}`);
            resolve({ smelted: smeltedCount });
          }, 2000);
        } else {
          // Set inactivity timeout (if no updates for 30 seconds, something's wrong)
          updateTimeout = setTimeout(() => {
            cleanup();
            reject(new Error('Smelting stalled - no updates received'));
          }, 30000);
        }
      });

      // Initial trigger
      furnace.emit('update');
    });
  }
}

export default SmeltingManager;