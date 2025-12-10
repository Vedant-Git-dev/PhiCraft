import minecraftData from 'minecraft-data';
import { log, logSuccess, logWarning } from './logger.js';

/**
 * Resource Calculator - Calculates required materials for building
 */

class ResourceCalculator {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
  }

  /**
   * Calculate required resources from blueprint
   */
  calculateRequiredResources(blueprint) {
    log('Calculating required resources...');

    const required = {};
    const unsupported = [];

    // Count all blocks
    for (const block of blueprint.blocks) {
      let blockName = block.name;
      if (blockName.startsWith('wall_')) {
      blockName = blockName.replace('wall_', '');
    }

      // Check if block is supported/placeable
      if (!this.isPlaceableBlock(blockName)) {
        if (!unsupported.includes(blockName)) {
          unsupported.push(blockName);
        }
        continue;
      }

      // Add to required materials
      required[blockName] = (required[blockName] || 0) + 1;
    }

    if (unsupported.length > 0) {
      logWarning(`Unsupported blocks found: ${unsupported.join(', ')}`);
    }

    log(`Required materials calculated: ${Object.keys(required).length} types`);

    return {
      required,
      unsupported,
      totalBlocks: Object.values(required).reduce((a, b) => a + b, 0)
    };
  }

  /**
   * Check what resources are missing from inventory
   */
  checkMissingResources(requiredResources) {
    log('Checking inventory for missing resources...');

    const missing = {};
    const available = {};

    for (const [blockName, requiredCount] of Object.entries(requiredResources)) {
     
      if (blockName.startsWith('wall_')) {
      blockName = blockName.replace('wall_', '');
    }
      const item = this.mcData.itemsByName[blockName];
      
      if (!item) {
        logWarning(`Unknown item: ${blockName}`);
        continue;
      }

      const currentCount = this.bot.inventory.count(item.id);
      available[blockName] = currentCount;

      if (currentCount < requiredCount) {
        missing[blockName] = requiredCount - currentCount;
      }
    }

    const missingCount = Object.keys(missing).length;
    
    if (missingCount === 0) {
      logSuccess('All required resources available!');
    } else {
      log(`Missing ${missingCount} resource types`);
    }

    return {
      missing,
      available,
      hasAll: missingCount === 0
    };
  }

  /**
   * Generate resource gathering plan
   */
  generateGatheringPlan(missingResources) {
    log('Generating resource gathering plan...');

    const plan = {
      mine: [],
      craft: [],
      smelt: [],
      unknown: []
    };

    for (const [blockName, count] of Object.entries(missingResources)) {
      const action = this.determineGatheringMethod(blockName);
      
      if (action.method === 'mine') {
        plan.mine.push({
          item: blockName,
          count: count,
          block: action.blockToMine
        });
      } else if (action.method === 'craft') {
        plan.craft.push({
          item: blockName,
          count: count
        });
      } else if (action.method === 'smelt') {
        plan.smelt.push({
          item: blockName,
          count: count,
          input: action.smeltInput
        });
      } else {
        plan.unknown.push({
          item: blockName,
          count: count
        });
      }
    }

    log(`Gathering plan: ${plan.mine.length} mine, ${plan.craft.length} craft, ${plan.smelt.length} smelt, ${plan.unknown.length} unknown`);

    return plan;
  }

  /**
   * Determine how to gather a specific resource
   */
  determineGatheringMethod(itemName) {
    // Check if it's a mineable block
    const blockMappings = {
      'oak_planks': { method: 'craft', craftFrom: 'oak_log' },
      'spruce_planks': { method: 'craft', craftFrom: 'spruce_log' },
      'birch_planks': { method: 'craft', craftFrom: 'birch_log' },
      'cobblestone': { method: 'mine', blockToMine: 'stone' },
      'stone': { method: 'mine', blockToMine: 'stone' },
      'dirt': { method: 'mine', blockToMine: 'dirt' },
      'glass': { method: 'smelt', smeltInput: 'sand' },
      'stone_bricks': { method: 'craft', craftFrom: 'stone' },
      'oak_log': { method: 'mine', blockToMine: 'oak_log' },
      'spruce_log': { method: 'mine', blockToMine: 'spruce_log' },
      'birch_log': { method: 'mine', blockToMine: 'birch_log' },
      'sandstone': { method: 'craft', craftFrom: 'sand' },
      'wool': { method: 'craft', craftFrom: 'string' },
      'bricks': { method: 'craft', craftFrom: 'brick' },
      'iron_block': { method: 'craft', craftFrom: 'iron_ingot' },
      'gold_block': { method: 'craft', craftFrom: 'gold_ingot' },
      'diamond_block': { method: 'craft', craftFrom: 'diamond' }
    };

    if (blockMappings[itemName]) {
      return blockMappings[itemName];
    }

    // Default: try to mine it
    const blockData = this.mcData.blocksByName[itemName];
    if (blockData) {
      return { method: 'mine', blockToMine: itemName };
    }

    return { method: 'unknown' };
  }

  /**
   * Check if a block is placeable
   */
  isPlaceableBlock(blockName) {
    // Blocks that cannot be placed or are special
    const unplaceable = [
      'air',
      'water',
      'lava',
      'fire',
      'bedrock',
      'end_portal',
      'end_portal_frame',
      'nether_portal',
      'barrier',
      'structure_void',
      'command_block',
      'structure_block'
    ];

    return !unplaceable.includes(blockName);
  }

  /**
   * Get detailed resource report
   */
  getResourceReport(blueprint) {
    const resources = this.calculateRequiredResources(blueprint);
    const inventory = this.checkMissingResources(resources.required);
    const plan = this.generateGatheringPlan(inventory.missing);

    return {
      required: resources.required,
      unsupported: resources.unsupported,
      totalBlocks: resources.totalBlocks,
      available: inventory.available,
      missing: inventory.missing,
      hasAllResources: inventory.hasAll,
      gatheringPlan: plan
    };
  }

  /**
   * Format resource list for display
   */
  formatResourceList(resources) {
    const lines = [];
    
    for (const [name, count] of Object.entries(resources)) {
      lines.push(`  ${name}: ${count}`);
    }

    return lines.join('\n');
  }
}

export default ResourceCalculator;