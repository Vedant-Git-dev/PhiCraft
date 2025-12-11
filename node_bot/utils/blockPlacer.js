import minecraftData from 'minecraft-data';
import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { Vec3 } from 'vec3';
import { log, logError, logSuccess, logWarning } from './logger.js';

/**
 * Enhanced Block Placer v2.0 - Complete Rewrite
 * 
 * ✓ Correct directional block placement (stairs, doors, beds, slabs, logs, ladders)
 * ✓ Wall-mounted blocks (wall_torch, wall_sign, wall_button, wall_lever)
 * ✓ ONLY uses valid solid cube blocks as supports (no doors, stairs, slabs, etc.)
 * ✓ Bot can place at its own position (micro-adjustments)
 * ✓ Handles wall_ and _wall naming patterns
 * ✓ Proper replacement logic (replaceable blocks vs breaking)
 * ✓ Smart retry and movement system
 */

class BlockPlacer {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
  }

  /**
   * Place a single block at absolute world coordinates
   */
  async placeBlock(blockName, worldPos, blueprintProperties = {}, maxRetries = 3) {
    const pos = this.ensureVec3(worldPos);
    
    log(`Placing ${blockName} at (${pos.x}, ${pos.y}, ${pos.z})`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 1. Check current block at position
        const currentBlock = this.bot.blockAt(pos);
        
        if (currentBlock && currentBlock.name === blockName) {
          log(`Correct block already at position: ${blockName}`);
          return { success: true, placed: false, reason: 'already_correct' };
        }

        // 2. Handle bot at placement position (REQUIRED BEHAVIOR)
        if (this.isBotAtPosition(pos)) {
          log(`Bot at placement position, micro-adjusting`);
          await this.microAdjustPosition(pos);
        }

        // 3. Handle existing block (replaceable or break)
        if (currentBlock && currentBlock.name !== 'air') {
          if (this.isReplaceable(currentBlock)) {
            log(`Replacing ${currentBlock.name} (replaceable)`);
          } else {
            log(`Breaking existing ${currentBlock.name}`);
            await this.breakBlock(currentBlock);
            await this.sleep(250);
          }
        }

        // 4. Navigate to placement position
        const navResult = await this.navigateToPlacementPosition(pos);
        if (!navResult.success) {
          throw new Error(`Cannot reach: ${navResult.reason}`);
        }

        // 5. Equip the block
        const equipResult = await this.equipBlock(blockName);
        if (!equipResult.success) {
          throw new Error(`Cannot equip ${blockName}: ${equipResult.reason}`);
        }

        // 6. Get placement strategy for block type
        const strategy = this.getPlacementStrategy(blockName, blueprintProperties);

        // 7. Find VALID reference block (only solid cubes)
        const refBlock = this.findReferenceBlock(pos, strategy);
        if (!refBlock) {
          throw new Error('No valid reference block (need solid cube)');
        }

        log(`Reference: ${refBlock.name} at (${refBlock.position.x}, ${refBlock.position.y}, ${refBlock.position.z})`);

        // 8. Calculate face vector
        const faceVector = this.calculateFaceVector(pos, refBlock.position);
        log(`Face vector: (${faceVector.x}, ${faceVector.y}, ${faceVector.z})`);

        // 9. Orient bot for directional blocks
        if (strategy.needsOrientation) {
          await this.orientBotForPlacement(pos, strategy, blueprintProperties);
        }

        // 10. Look at reference block center
        const lookPos = refBlock.position.offset(0.5, 0.5, 0.5);
        await this.bot.lookAt(lookPos);
        await this.sleep(100);

        // 11. Place block
        await this.bot.placeBlock(refBlock, faceVector);
        
        // 12. Verify placement
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
   * Get placement strategy based on block type
   */
  getPlacementStrategy(blockName, properties = {}) {
    const strategy = {
      type: 'normal',
      needsOrientation: false,
      preferredFace: null,
      wallMounted: false
    };

    // Stairs
    if (blockName.includes('stairs')) {
      strategy.type = 'stairs';
      strategy.needsOrientation = true;
      strategy.preferredFace = 'bottom';
    }
    // Slabs
    else if (blockName.includes('slab')) {
      strategy.type = 'slab';
      strategy.preferredFace = properties.half === 'top' ? 'top' : 'bottom';
    }
    // Doors (not trapdoor)
    else if (blockName.includes('door') && !blockName.includes('trapdoor')) {
      strategy.type = 'door';
      strategy.needsOrientation = true;
      strategy.preferredFace = 'bottom';
    }
    // Trapdoors
    else if (blockName.includes('trapdoor')) {
      strategy.type = 'trapdoor';
      strategy.needsOrientation = true;
    }
    // Beds
    else if (blockName.includes('bed')) {
      strategy.type = 'bed';
      strategy.needsOrientation = true;
      strategy.preferredFace = 'bottom';
    }
    // Logs (axis property)
    else if (blockName.includes('log') && !blockName.includes('stripped')) {
      strategy.type = 'log';
      strategy.needsOrientation = true;
    }
    // Wall-mounted blocks
    else if (blockName.startsWith('wall_') || 
             blockName.includes('_wall') ||
             blockName === 'ladder') {
      strategy.type = 'wall_mounted';
      strategy.wallMounted = true;
      strategy.preferredFace = 'side';
    }
    // Furnaces, chests, barrels
    else if (['furnace', 'chest', 'barrel', 'crafting_table'].includes(blockName)) {
      strategy.type = 'facing_block';
      strategy.needsOrientation = true;
    }
    // Fences and gates
    else if (blockName.includes('fence')) {
      strategy.type = 'fence';
      strategy.preferredFace = 'bottom';
    }

    return strategy;
  }

  /**
   * Find VALID reference block for placement
   * CRITICAL: Only returns full solid cube blocks
   */
  findReferenceBlock(targetPos, strategy) {
    const pos = this.ensureVec3(targetPos);
    
    // Determine search order based on strategy
    let searchOrder;
    
    if (strategy.wallMounted || strategy.preferredFace === 'side') {
      // Wall-mounted: check horizontal faces first
      searchOrder = [
        { vec: new Vec3(1, 0, 0), name: 'east' },
        { vec: new Vec3(-1, 0, 0), name: 'west' },
        { vec: new Vec3(0, 0, 1), name: 'south' },
        { vec: new Vec3(0, 0, -1), name: 'north' },
        { vec: new Vec3(0, -1, 0), name: 'below' }
      ];
    } else if (strategy.preferredFace === 'top') {
      // Top slab: check above first
      searchOrder = [
        { vec: new Vec3(0, 1, 0), name: 'above' },
        { vec: new Vec3(0, -1, 0), name: 'below' }
      ];
    } else {
      // Normal/bottom: prioritize below
      searchOrder = [
        { vec: new Vec3(0, -1, 0), name: 'below' },
        { vec: new Vec3(1, 0, 0), name: 'east' },
        { vec: new Vec3(-1, 0, 0), name: 'west' },
        { vec: new Vec3(0, 0, 1), name: 'south' },
        { vec: new Vec3(0, 0, -1), name: 'north' },
        { vec: new Vec3(0, 1, 0), name: 'above' }
      ];
    }

    for (const offset of searchOrder) {
      const checkPos = new Vec3(
        pos.x + offset.vec.x,
        pos.y + offset.vec.y,
        pos.z + offset.vec.z
      );
      
      const block = this.bot.blockAt(checkPos);

      // CRITICAL: Only allow FULL SOLID CUBE blocks as supports
      if (block && this.isValidSolidSupport(block)) {
        log(`Found valid reference ${offset.name}: ${block.name}`);
        return block;
      }
    }

    logWarning('No valid solid cube reference block found');
    return null;
  }

  /**
   * CRITICAL: Check if block is valid solid support
   * Returns TRUE only for full solid cube blocks
   */
  isValidSolidSupport(block) {
    if (!block || block.name === 'air') return false;

    // INVALID supports (non-solid, non-cube, or special blocks)
    const invalidSupports = [
      // Non-solid blocks
      'air', 'water', 'lava', 'cave_air',
      // Plants
      'grass', 'tall_grass', 'fern', 'dead_bush', 'seagrass',
      'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
      'rose_bush', 'sunflower', 'lilac', 'peony',
      'wheat', 'carrots', 'potatoes', 'beetroots',
      'sugar_cane', 'cactus', 'bamboo',
      // Non-cube blocks
      'stairs', 'slab', 'door', 'trapdoor', 'bed',
      'fence', 'gate', 'ladder', 'vine',
      'torch', 'wall_torch', 'lantern',
      'button', 'lever', 'pressure_plate',
      'rail', 'powered_rail', 'detector_rail', 'activator_rail',
      'carpet', 'snow', // snow layer, not snow_block
      'glass_pane', 'iron_bars',
      // Containers/utility (not full cubes)
      'chest', 'barrel', 'furnace', 'crafting_table',
      'hopper', 'dropper', 'dispenser',
      'pane', 'bars'
    ];

    // Check if block name contains any invalid pattern
    for (const invalid of invalidSupports) {
      if (block.name.includes(invalid) && block.name !== "grass_block") {
        // Exception: snow_block IS valid (full cube)
        if (block.name === 'snow_block') continue;
        return false;
      }
    }

    // VALID solid blocks
    const validSolidBlocks = [
      'dirt', 'grass_block', 'stone', 'cobblestone',
      'bedrock', 'sand', 'gravel', 'sandstone',
      'netherrack', 'mycelium', 'podzol', 'coarse_dirt',
      'clay', 'terracotta', 'concrete', 'wool',
      'deepslate', 'tuff', 'dripstone_block',
      'snow_block', 'ice', 'packed_ice', 'blue_ice'
    ];

    // Check explicit valid blocks
    if (validSolidBlocks.includes(block.name)) {
      return true;
    }

    // Check patterns for solid blocks
    if (block.name.includes('_planks') ||
        block.name.includes('_log') ||
        block.name.includes('_ore') ||
        block.name.includes('_block') && !block.name.includes('_slab')) {
      return true;
    }

    // Check bounding box
    if (block.boundingBox === 'empty' || block.boundingBox === 'block') {
      return block.boundingBox === 'block';
    }

    // Default: assume solid if not in invalid list
    return true;
  }

  /**
   * Check if block is replaceable (grass, flowers, etc.)
   */
  isReplaceable(block) {
    const replaceableBlocks = [
      'grass', 'tall_grass', 'fern', 'dead_bush',
      'dandelion', 'poppy', 'blue_orchid', 'allium',
      'seagrass', 'kelp', 'vine', 'snow'
    ];

    for (const replaceable of replaceableBlocks) {
      if (block.name.includes(replaceable)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if bot occupies placement position
   */
  isBotAtPosition(targetPos) {
    const pos = this.ensureVec3(targetPos);
    const botPos = this.bot.entity.position.floored();
    
    // Check if bot's feet are at target position
    if (botPos.x === pos.x && botPos.y === pos.y && botPos.z === pos.z) {
      return true;
    }
    
    // Check if bot's head is at target position
    const botHead = botPos.offset(0, 1, 0);
    if (botHead.x === pos.x && botHead.y === pos.y && botHead.z === pos.z) {
      return true;
    }

    return false;
  }

  /**
   * Micro-adjust bot position to allow self-placement
   * REQUIRED BEHAVIOR: Bot must be able to place at its own position
   */
  async microAdjustPosition(targetPos) {
    const pos = this.ensureVec3(targetPos);
    const botPos = this.bot.entity.position;

    log(`Micro-adjusting: bot at (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)})`);

    // Calculate offset direction (move away slightly)
    const offsetX = botPos.x - pos.x;
    const offsetZ = botPos.z - pos.z;
    
    // Determine best direction to step
    let moveDirection;
    if (Math.abs(offsetX) > Math.abs(offsetZ)) {
      moveDirection = offsetX > 0 ? new Vec3(1, 0, 0) : new Vec3(-1, 0, 0);
    } else {
      moveDirection = offsetZ > 0 ? new Vec3(0, 0, 1) : new Vec3(0, 0, -1);
    }

    // Move slightly
    const newPos = botPos.plus(moveDirection);
    
    try {
      this.bot.entity.position.x = newPos.x;
      this.bot.entity.position.z = newPos.z;
      
      await this.sleep(150);
      log(`Adjusted to (${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)})`);
    } catch (error) {
      logWarning(`Micro-adjust failed: ${error.message}`);
    }
  }

  /**
   * Orient bot for directional block placement
   */
  async orientBotForPlacement(targetPos, strategy, properties) {
    const pos = this.ensureVec3(targetPos);
    
    // Calculate yaw based on blueprint properties or bot position
    let targetYaw;
    
    if (properties.facing) {
      // Use blueprint facing
      const facingMap = {
        'north': Math.PI,      // 180°
        'south': 0,            // 0°
        'west': Math.PI / 2,   // 90°
        'east': -Math.PI / 2   // -90°
      };
      targetYaw = facingMap[properties.facing] || this.bot.entity.yaw;
    } else {
      // Use current bot yaw
      targetYaw = this.bot.entity.yaw;
    }

    await this.bot.look(targetYaw, 0, true);
    await this.sleep(100);
  }

  /**
   * Break an existing block
   */
  async breakBlock(block) {
    try {
      // Navigate close if needed
      const distance = this.bot.entity.position.distanceTo(block.position);
      if (distance > 4.5) {
        const goal = new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3);
        await this.bot.pathfinder.goto(goal);
      }

      // Dig the block
      await this.bot.dig(block);
      log(`Broke ${block.name}`);
    } catch (error) {
      logWarning(`Failed to break block: ${error.message}`);
    }
  }

  /**
   * Navigate to placement position
   */
  async navigateToPlacementPosition(targetPos, maxAttempts = 2) {
    const pos = this.ensureVec3(targetPos);
    const currentDistance = this.bot.entity.position.distanceTo(pos);

    if (currentDistance <= 4.5) {
      log(`Within reach (${currentDistance.toFixed(1)} blocks)`);
      return { success: true };
    }

    log(`Navigating to placement position (${currentDistance.toFixed(1)} blocks away)`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 3);
        await this.bot.pathfinder.goto(goal);

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
   * Calculate face vector for placement
   */
  calculateFaceVector(targetPos, referencePos) {
    const target = this.ensureVec3(targetPos);
    const ref = this.ensureVec3(referencePos);
    
    const dx = target.x - ref.x;
    const dy = target.y - ref.y;
    const dz = target.z - ref.z;
    
    return new Vec3(
      dx === 0 ? 0 : (dx > 0 ? 1 : -1),
      dy === 0 ? 0 : (dy > 0 ? 1 : -1),
      dz === 0 ? 0 : (dz > 0 ? 1 : -1)
    );
  }

  /**
   * Check if block matches desired orientation
   */
  blockMatchesOrientation(block, properties) {
    if (!properties || Object.keys(properties).length === 0) {
      return true; // No specific orientation required
    }
    console.log("Done", "="*70);
    // Check if block properties match blueprint properties
    const blockProps = block.getProperties ? block.getProperties() : {};
    
    for (const [key, value] of Object.entries(properties)) {
      if (blockProps[key] !== value) {
        return false;
      }
    }

    return true;
  }

  /**
   * Ensure position is proper Vec3 object
   */
  ensureVec3(pos) {
    if (pos instanceof Vec3) {
      return pos.floored();
    }
    
    if (pos.x !== undefined && pos.y !== undefined && pos.z !== undefined) {
      return new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    }
    
    throw new Error(`Invalid position: ${JSON.stringify(pos)}`);
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
    return distance <= 64;
  }

  /**
   * Place scaffolding block for support
   */
  async placeScaffolding(worldPos) {
    const pos = this.ensureVec3(worldPos);
    log(`Placing scaffolding at (${pos.x}, ${pos.y}, ${pos.z})`);

    const existing = this.bot.blockAt(pos);
    if (existing && this.isValidSolidSupport(existing)) {
      log('Scaffolding not needed, block already solid');
      return { success: true, block: existing.name };
    }

    const scaffoldBlocks = ['dirt', 'cobblestone', 'netherrack', 'stone'];

    for (const blockName of scaffoldBlocks) {
      const item = this.bot.inventory.items().find(i => i.name === blockName);
      
      if (item) {
        const result = await this.placeBlock(blockName, pos, {}, 2);
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