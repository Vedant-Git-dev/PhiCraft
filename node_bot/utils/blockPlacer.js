import minecraftData from 'minecraft-data';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { Vec3 } from 'vec3';
import { log, logError, logSuccess, logWarning } from './logger.js';

/**
 * Block Placer - Handles individual block placement with retry logic
 * FIXED: Proper solid block detection (grass_block is solid!)
 */

class BlockPlacer {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
  }

  /**
   * Place a single block at absolute world coordinates
   */
  async placeBlock(blockName, worldPos, maxRetries = 3) {
    
    // Ensure worldPos is a proper Vec3
    const pos = this.ensureVec3(worldPos);
    
    log(`Placing ${blockName} at (${pos.x}, ${pos.y}, ${pos.z})`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check current block at position
        const currentBlock = this.bot.blockAt(pos);
        
        // If correct block already exists, mark as already placed
        if (currentBlock && currentBlock.name === blockName) {
          log(`Correct block already at position: ${blockName}`);
          return { success: true, placed: false, reason: 'already_correct' };
        }

        // Navigate to placement position
        const navResult = await this.navigateToPlacementPosition(pos);
        if (!navResult.success) {
          throw new Error(`Cannot reach placement position: ${navResult.reason}`);
        }

        // Equip the block
        const equipResult = await this.equipBlock(blockName);
        if (!equipResult.success) {
          throw new Error(`Cannot equip ${blockName}: ${equipResult.reason}`);
        }

        // Find reference block to place against
        const refBlock = this.findReferenceBlock(pos);
        if (!refBlock) {
          throw new Error('No reference block found for placement');
        }

        log(`Using reference block: ${refBlock.name} at (${refBlock.position.x}, ${refBlock.position.y}, ${refBlock.position.z})`);

        // Calculate face vector
        const faceVector = this.calculateFaceVector(pos, refBlock.position);
        log(`Face vector: (${faceVector.x}, ${faceVector.y}, ${faceVector.z})`);

        // Look at the reference block center
        const lookPos = refBlock.position.offset(0.5, 0.5, 0.5);
        await this.bot.lookAt(lookPos);
        await this.sleep(150);

        // Place block
        await this.bot.placeBlock(refBlock, faceVector);
        
        // Verify placement
        await this.sleep(300);
        
        const verifyBlock = this.bot.blockAt(pos);
        if (verifyBlock && verifyBlock.name === blockName) {
          logSuccess(`Successfully placed ${blockName}`);
          return { success: true, placed: true };
        } else {
          const actualBlock = verifyBlock ? verifyBlock.name : 'air';
          throw new Error(`Verification failed: expected ${blockName}, got ${actualBlock}`);
        }

      } catch (error) {
        logWarning(`Placement attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          await this.sleep(500);
        } else {
          logError(`Failed to place ${blockName} after ${maxRetries} attempts`);
          return { 
            success: false, 
            placed: false, 
            reason: error.message 
          };
        }
      }
    }

    return { success: false, placed: false, reason: 'max_retries_exceeded' };
  }

  /**
   * Ensure position is a proper Vec3 object
   */
  ensureVec3(pos) {
    if (pos instanceof Vec3) {
      return pos;
    }
    
    if (pos.x !== undefined && pos.y !== undefined && pos.z !== undefined) {
      return new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    }
    
    throw new Error(`Invalid position: ${JSON.stringify(pos)}`);
  }

  /**
   * Navigate to a position where block can be placed
   */
  async navigateToPlacementPosition(targetPos, maxAttempts = 2) {
    const pos = this.ensureVec3(targetPos);
    const currentDistance = this.bot.entity.position.distanceTo(pos);

    if (currentDistance <= 4.5) {
      log(`Already within reach (${currentDistance.toFixed(1)} blocks)`);
      return { success: true };
    }

    log(`Navigating to placement position (${currentDistance.toFixed(1)} blocks away)...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Navigate to near the target position
        const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 3);
        await this.bot.pathfinder.goto(goal);

        // Check if we're close enough
        const newDistance = this.bot.entity.position.distanceTo(pos);
        if (newDistance <= 4.5) {
          log(`Reached placement position (${newDistance.toFixed(1)} blocks)`);
          return { success: true };
        }

        throw new Error(`Still too far: ${newDistance.toFixed(1)} blocks`);

      } catch (error) {
        logWarning(`Navigation attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
        
        if (attempt < maxAttempts) {
          await this.sleep(500);
        }
      }
    }

    return { success: false, reason: 'cannot_reach' };
  }

  /**
   * Equip block from inventory
   */
  async equipBlock(blockName) {
    const item = this.mcData.itemsByName[blockName];
    
    if (!item) {
      return { success: false, reason: 'unknown_item' };
    }

    // Find item in inventory
    const inventoryItem = this.bot.inventory.items().find(i => i.name === blockName);
    
    if (!inventoryItem) {
      return { success: false, reason: 'not_in_inventory' };
    }

    try {
      await this.bot.equip(inventoryItem, 'hand');
      log(`Equipped ${blockName}`);
      return { success: true };
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * Find a reference block to place against
   * FIXED: Proper coordinate handling
   */
  findReferenceBlock(targetPos) {
    const pos = this.ensureVec3(targetPos);
    
    log(`Looking for reference block near (${pos.x}, ${pos.y}, ${pos.z})`);
    
    // Check all 6 directions (prioritize below, then sides, then above)
    const offsets = [
      { vec: new Vec3(0, -1, 0), name: 'below' },
      { vec: new Vec3(1, 0, 0), name: 'east' },
      { vec: new Vec3(-1, 0, 0), name: 'west' },
      { vec: new Vec3(0, 0, 1), name: 'south' },
      { vec: new Vec3(0, 0, -1), name: 'north' },
      { vec: new Vec3(0, 1, 0), name: 'above' }
    ];

    for (const offset of offsets) {
      const checkPos = new Vec3(
        pos.x + offset.vec.x,
        pos.y + offset.vec.y,
        pos.z + offset.vec.z
      );
      
      const block = this.bot.blockAt(checkPos);

      if (block && this.isSolidBlock(block)) {
        log(`Found reference block ${offset.name}: ${block.name} at (${checkPos.x}, ${checkPos.y}, ${checkPos.z})`);
        return block;
      } else {
        const blockType = block ? block.name : 'null';
        const solidCheck = block ? this.isSolidBlock(block) : false;
        log(`  Checked ${offset.name} (${checkPos.x}, ${checkPos.y}, ${checkPos.z}): ${blockType} - ${solidCheck ? 'SOLID' : 'not suitable'}`);
      }
    }

    // No reference block found
    logWarning('No reference block found in any direction');
    return null;
  }

  /**
   * Check if block is solid (can be used as reference)
   * FIXED: grass_block, mycelium, podzol ARE solid!
   */
  isSolidBlock(block) {
    if (!block) return false;
    if (block.name === 'air') return false;

    // Explicitly solid blocks (including grass variants)
    const solidBlocks = [
      'grass_block',      // This is SOLID (the main grass block)
      'dirt',
      'stone',
      'cobblestone',
      'bedrock',
      'sand',
      'gravel',
      'sandstone',
      'netherrack',
      'mycelium',
      'podzol',
      'coarse_dirt',
      'clay',
      'terracotta',
      'concrete',
      'wool',
      'deepslate'
    ];

    // Check explicit solid blocks
    if (solidBlocks.includes(block.name)) {
      return true;
    }

    // Check if it's any plank type
    if (block.name.includes('_planks')) {
      return true;
    }

    // Check if it's any log type
    if (block.name.includes('_log')) {
      return true;
    }

    // Check if it's any ore
    if (block.name.includes('_ore')) {
      return true;
    }

    // List of NON-solid blocks (plants, decorations, etc.)
    const nonSolid = [
      'air', 'water', 'lava', 'cave_air',
      'tall_grass',       // This is NOT solid (the plant)
      'grass',            // This is NOT solid (the plant)
      'seagrass',
      'fern',
      'dead_bush',
      'dandelion',
      'poppy',
      'rose_bush',
      'sunflower',
      'lilac',
      'peony',
      'blue_orchid',
      'allium',
      'azure_bluet',
      'oxeye_daisy',
      'cornflower',
      'lily_of_the_valley',
      'wither_rose',
      'flower',
      'sapling',
      'torch',
      'redstone_wire',
      'rail',
      'ladder',
      'vine',
      'kelp',
      'snow',           // Snow layer (not solid)
      'sugar_cane',
      'wheat',
      'carrots',
      'potatoes',
      'beetroots',
      'sweet_berry_bush',
      'bamboo',
      'scaffolding'
    ];

    // Check if block name contains any non-solid keywords
    for (const keyword of nonSolid) {
      if (block.name === keyword || block.name.includes(keyword)) {
        // Exception: snow_block IS solid (not the same as snow layer)
        if (block.name === 'snow_block') {
          return true;
        }
        return false;
      }
    }

    // Check bounding box
    if (block.boundingBox === 'empty') {
      return false;
    }

    // Default: if it has a bounding box and isn't in non-solid list, it's probably solid
    return true;
  }

  /**
   * Calculate face vector for placement
   * FIXED: Proper vector calculation
   */
  calculateFaceVector(targetPos, referencePos) {
    const target = this.ensureVec3(targetPos);
    const ref = this.ensureVec3(referencePos);
    
    // Calculate difference
    const dx = target.x - ref.x;
    const dy = target.y - ref.y;
    const dz = target.z - ref.z;
    
    // Return normalized direction
    return new Vec3(
      dx === 0 ? 0 : (dx > 0 ? 1 : -1),
      dy === 0 ? 0 : (dy > 0 ? 1 : -1),
      dz === 0 ? 0 : (dz > 0 ? 1 : -1)
    );
  }

  /**
   * Check if position is obstructed
   */
  isPositionObstructed(worldPos) {
    const pos = this.ensureVec3(worldPos);
    const block = this.bot.blockAt(pos);
    return block && block.name !== 'air';
  }

  /**
   * Check if bot can reach position
   */
  canReachPosition(worldPos) {
    const pos = this.ensureVec3(worldPos);
    const distance = this.bot.entity.position.distanceTo(pos);
    return distance <= 64; // Pathfinder limit
  }

  /**
   * Place scaffolding block for support
   */
  async placeScaffolding(worldPos) {
    const pos = this.ensureVec3(worldPos);
    log(`Placing scaffolding at (${pos.x}, ${pos.y}, ${pos.z})`);

    // Check if already has solid block
    const existing = this.bot.blockAt(pos);
    if (existing && this.isSolidBlock(existing)) {
      log('Scaffolding not needed, block already solid');
      return { success: true, block: existing.name };
    }

    // Try to place dirt or cobblestone as scaffolding
    const scaffoldBlocks = ['dirt', 'cobblestone', 'netherrack', 'stone'];

    for (const blockName of scaffoldBlocks) {
      const item = this.bot.inventory.items().find(i => i.name === blockName);
      
      if (item) {
        const result = await this.placeBlock(blockName, pos, 2);
        if (result.success) {
          return { success: true, block: blockName };
        }
      }
    }

    return { success: false, reason: 'no_scaffolding_material' };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default BlockPlacer;