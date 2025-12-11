import { Vec3 } from 'vec3';
import { log, logError, logSuccess, logWarning } from './logger.js';
import BlockPlacer from './blockPlacer.js';
import ResourceCalculator from './resourceCalculator.js';

/**
 * Build Executor v2.0 - Enhanced with user prompts
 * 
 * Now asks user for:
 * - Base Y-level where build should start
 * - X, Z coordinates for build origin
 */

class BuildExecutor {
  constructor(bot) {
    this.bot = bot;
    this.blockPlacer = new BlockPlacer(bot);
    this.resourceCalculator = new ResourceCalculator(bot);
    this.currentBuild = null;
    this.aborted = false;
    this.userResponseCallback = null; // For getting user input
  }

  /**
   * Set callback for user interaction
   */
  setUserResponseCallback(callback) {
    this.userResponseCallback = callback;
  }

  /**
   * Ask user for build parameters via chat
   */
  async askUserForBuildParameters(blueprint) {
    log('\n=== ASKING USER FOR BUILD PARAMETERS ===');
    
    // Get bot's current position as default
    const botPos = this.bot.entity.position.floored();
    
    // Ask for Y-level
    this.bot.chat(`What Y-level should the build start at? (Current: ${botPos.y})`);
    this.bot.chat(`Type a number, or say "current" to use ${botPos.y}`);
    
    const yLevel = await this.waitForUserResponse('y_level', botPos.y);
    
    // Ask for X coordinate
    this.bot.chat(`What X coordinate? (Current: ${botPos.x})`);
    this.bot.chat(`Type a number, or say "current"`);
    
    const xCoord = await this.waitForUserResponse('x_coord', botPos.x);
    
    // Ask for Z coordinate
    this.bot.chat(`What Z coordinate? (Current: ${botPos.z})`);
    this.bot.chat(`Type a number, or say "current"`);
    
    const zCoord = await this.waitForUserResponse('z_coord', botPos.z);
    
    const origin = new Vec3(xCoord, yLevel, zCoord);
    
    this.bot.chat(`Build will start at: (${origin.x}, ${origin.y}, ${origin.z})`);
    this.bot.chat(`Size: ${blueprint.size.x}x${blueprint.size.y}x${blueprint.size.z}`);
    this.bot.chat(`Say "confirm" to proceed, or "cancel" to abort`);
    
    const confirmed = await this.waitForUserConfirmation();
    
    if (!confirmed) {
      throw new Error('Build cancelled by user');
    }
    
    logSuccess(`User confirmed build at (${origin.x}, ${origin.y}, ${origin.z})`);
    return origin;
  }

  /**
   * Wait for user to provide a numeric value
   */
  async waitForUserResponse(paramName, defaultValue) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log(`No response for ${paramName}, using default: ${defaultValue}`);
        resolve(defaultValue);
      }, 60000); // 60 second timeout

      // Store resolver for callback
      this.currentPrompt = {
        paramName,
        defaultValue,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        }
      };
    });
  }

  /**
   * Wait for user confirmation
   */
  async waitForUserConfirmation() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log('No confirmation, cancelling build');
        resolve(false);
      }, 60000);

      this.currentPrompt = {
        paramName: 'confirm',
        resolve: (confirmed) => {
          clearTimeout(timeout);
          resolve(confirmed);
        }
      };
    });
  }

  /**
   * Handle user response (called from chat handler)
   */
  handleUserResponse(message) {
    if (!this.currentPrompt) return false;

    const lowerMsg = message.toLowerCase().trim();
    
    if (this.currentPrompt.paramName === 'confirm') {
      if (lowerMsg === 'confirm' || lowerMsg === 'yes' || lowerMsg === 'y') {
        this.currentPrompt.resolve(true);
        this.currentPrompt = null;
        return true;
      } else if (lowerMsg === 'cancel' || lowerMsg === 'no' || lowerMsg === 'n') {
        this.currentPrompt.resolve(false);
        this.currentPrompt = null;
        return true;
      }
      return false;
    }

    // Handle numeric inputs
    if (lowerMsg === 'current') {
      this.currentPrompt.resolve(this.currentPrompt.defaultValue);
      this.currentPrompt = null;
      return true;
    }

    const numValue = parseInt(lowerMsg);
    if (!isNaN(numValue)) {
      this.currentPrompt.resolve(numValue);
      this.currentPrompt = null;
      return true;
    }

    return false;
  }

  /**
   * Execute complete building operation
   */
  async buildStructure(blueprint, originPos, options = {}) {
    // If no origin provided, ask user
    let origin;
    if (!originPos) {
      try {
        origin = await this.askUserForBuildParameters(blueprint);
      } catch (error) {
        return {
          success: false,
          status: 'cancelled',
          message: error.message
        };
      }
    } else {
      origin = this.ensureVec3Floor(originPos);
    }
    
    log(`\n=== STARTING BUILD ===`);
    log(`Origin: (${origin.x}, ${origin.y}, ${origin.z})`);
    log(`Size: ${blueprint.size.x}x${blueprint.size.y}x${blueprint.size.z}`);
    log(`Total blocks: ${blueprint.totalBlocks}`);

    this.aborted = false;
    this.currentBuild = {
      blueprint,
      originPos: origin,
      startTime: Date.now(),
      placedBlocks: 0,
      failedBlocks: 0,
      skippedBlocks: 0,
      clearedBlocks: 0
    };

    const {
      layerByLayer = true,
      skipAir = true,
      retryFailed = true,
      scaffolding = false,
      progressCallback = null,
      prepareGround = true,
      clearArea = true
    } = options;

    try {
      // Step 1: Prepare ground area
      if (prepareGround) {
        await this.prepareGroundArea(blueprint, origin);
      }

      // Step 2: Clear build area
      if (clearArea) {
        await this.clearBuildArea(blueprint, origin);
      }

      // Sort blocks by build order
      const sortedBlocks = this.sortBlocksByBuildOrder(blueprint.blocks, layerByLayer);

      log(`Building ${sortedBlocks.length} blocks...`);

      // Build each block
      for (let i = 0; i < sortedBlocks.length; i++) {
        if (this.aborted) {
          logWarning('Build aborted by user');
          break;
        }

        const block = sortedBlocks[i];
        const worldPos = this.relativeToWorld(block, origin);

        // Progress update
        if (progressCallback && i % 10 === 0) {
          progressCallback({
            current: i,
            total: sortedBlocks.length,
            placed: this.currentBuild.placedBlocks,
            failed: this.currentBuild.failedBlocks,
            skipped: this.currentBuild.skippedBlocks
          });
        }

        // Log every 5th block
        if (i % 5 === 0) {
          log(`Progress: ${i}/${sortedBlocks.length} (${this.currentBuild.placedBlocks} placed)`);
        }

        // Check if bot has the block
        const hasBlock = await this.ensureBlockAvailable(block.name);
        if (!hasBlock) {
          logWarning(`Missing block: ${block.name}`);
          this.currentBuild.skippedBlocks++;
          
          return {
            success: false,
            status: 'missing_items',
            required: { [block.name]: 1 },
            progress: {
              placed: this.currentBuild.placedBlocks,
              failed: this.currentBuild.failedBlocks,
              skipped: this.currentBuild.skippedBlocks,
              total: sortedBlocks.length
            }
          };
        }

        // Check if block already matches what we want
        const existingBlock = this.bot.blockAt(worldPos);
        if (existingBlock && existingBlock.name === block.name) {
          log(`Block ${block.name} already correct at position`);
          this.currentBuild.skippedBlocks++;
          continue;
        }

        // Place block with blueprint properties
        const result = await this.blockPlacer.placeBlock(
          block.name, 
          worldPos, 
          block.properties || {}
        );

        if (result.success) {
          if (result.placed) {
            this.currentBuild.placedBlocks++;
          } else {
            this.currentBuild.skippedBlocks++;
          }
        } else {
          this.currentBuild.failedBlocks++;
          logError(`Failed to place ${block.name}: ${result.reason}`);
          
          // Try scaffolding if enabled
          if (scaffolding && result.reason && result.reason.includes('reference block')) {
            log('Attempting scaffolding...');
            const scaffoldPos = new Vec3(worldPos.x, worldPos.y - 1, worldPos.z);
            await this.blockPlacer.placeScaffolding(scaffoldPos);
            
            // Retry placement
            const retryResult = await this.blockPlacer.placeBlock(block.name, worldPos, block.properties || {});
            if (retryResult.success) {
              this.currentBuild.placedBlocks++;
              this.currentBuild.failedBlocks--;
            }
          }
        }

        // Small delay to prevent server spam
        if (i % 3 === 0) {
          await this.sleep(100);
        }
      }

      const duration = ((Date.now() - this.currentBuild.startTime) / 1000).toFixed(1);

      logSuccess(`\n=== BUILD COMPLETE ===`);
      log(`Duration: ${duration}s`);
      log(`Placed: ${this.currentBuild.placedBlocks}`);
      log(`Failed: ${this.currentBuild.failedBlocks}`);
      log(`Skipped: ${this.currentBuild.skippedBlocks}`);
      log(`Cleared: ${this.currentBuild.clearedBlocks}`);

      return {
        success: true,
        status: 'completed',
        placed: this.currentBuild.placedBlocks,
        failed: this.currentBuild.failedBlocks,
        skipped: this.currentBuild.skippedBlocks,
        cleared: this.currentBuild.clearedBlocks,
        duration: duration
      };

    } catch (error) {
      logError(`Build error: ${error.message}`);
      
      return {
        success: false,
        status: 'error',
        error: error.message,
        placed: this.currentBuild.placedBlocks,
        failed: this.currentBuild.failedBlocks
      };
    }
  }

  /**
   * Ensure position is proper Vec3 and floored
   */
  ensureVec3Floor(pos) {
    if (pos instanceof Vec3) {
      return pos.floored();
    }
    return new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  }

  /**
   * Prepare ground area - flatten and create solid foundation
   */
  async prepareGroundArea(blueprint, originPos) {
    log('\n=== PREPARING GROUND ===');

    const origin = this.ensureVec3Floor(originPos);
    const sizeX = blueprint.size.x;
    const sizeZ = blueprint.size.z;
    const baseY = origin.y;

    log(`Base Y level: ${baseY}`);
    log('Checking foundation...');
    
    for (let x = 0; x < sizeX; x++) {
      for (let z = 0; z < sizeZ; z++) {
        const checkPos = new Vec3(origin.x + x, baseY - 1, origin.z + z);
        const block = this.bot.blockAt(checkPos);

        if (!block || !this.isSolidGround(block)) {
          log(`Foundation missing at (${checkPos.x}, ${checkPos.y}, ${checkPos.z})`);
          await this.fillGroundBlock(checkPos);
        }
      }
    }

    logSuccess('Ground prepared');
  }

  /**
   * Clear build area - remove existing blocks
   */
  async clearBuildArea(blueprint, originPos) {
    log('\n=== CLEARING BUILD AREA ===');

    const origin = this.ensureVec3Floor(originPos);
    const sizeX = blueprint.size.x;
    const sizeY = blueprint.size.y;
    const sizeZ = blueprint.size.z;

    let cleared = 0;

    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        for (let z = 0; z < sizeZ; z++) {
          const worldPos = new Vec3(
            origin.x + x,
            origin.y + y,
            origin.z + z
          );

          const block = this.bot.blockAt(worldPos);

          if (!block || block.name === 'air') {
            continue;
          }

          const blueprintBlock = blueprint.blocks.find(
            b => b.x === x && b.y === y && b.z === z
          );

          if (blueprintBlock && block.name === blueprintBlock.name) {
            continue;
          }

          try {
            await this.clearBlock(worldPos);
            cleared++;
            this.currentBuild.clearedBlocks++;
            
            if (cleared % 10 === 0) {
              log(`Cleared ${cleared} blocks...`);
            }
          } catch (error) {
            logWarning(`Failed to clear block: ${error.message}`);
          }
        }
      }
    }

    if (cleared > 0) {
      logSuccess(`Cleared ${cleared} blocks`);
    } else {
      log('Area already clear');
    }
  }

  /**
   * Clear a single block
   */
  async clearBlock(worldPos) {
    const pos = this.ensureVec3Floor(worldPos);
    const block = this.bot.blockAt(pos);
    
    if (!block || block.name === 'air') {
      return;
    }

    const distance = this.bot.entity.position.distanceTo(pos);
    if (distance > 4.5) {
      const pathfinderPlugin = await import('mineflayer-pathfinder');
      const { goals } = pathfinderPlugin.default;
      const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 3);
      
      try {
        await this.bot.pathfinder.goto(goal);
      } catch (error) {
        return;
      }
    }

    try {
      await this.bot.dig(block);
      await this.sleep(150);
    } catch (error) {
      // Couldn't dig, skip
    }
  }

  /**
   * Fill a ground block with suitable material
   */
  async fillGroundBlock(worldPos) {
    const pos = this.ensureVec3Floor(worldPos);
    const existingBlock = this.bot.blockAt(pos);
    
    if (existingBlock && this.isSolidGround(existingBlock)) {
      return;
    }

    const fillMaterials = ['dirt', 'cobblestone', 'stone', 'netherrack'];

    for (const material of fillMaterials) {
      const hasItem = this.bot.inventory.items().find(i => i.name === material);
      
      if (hasItem) {
        try {
          await this.blockPlacer.placeBlock(material, pos);
          return;
        } catch (error) {
          continue;
        }
      }
    }

    log(`No fill material available for ground`);
  }

  /**
   * Check if block is solid ground
   */
  isSolidGround(block) {
    if (!block) return false;

    const solidBlocks = [
      'dirt', 'grass_block', 'stone', 'cobblestone', 
      'deepslate', 'netherrack', 'sand', 'gravel',
      'sandstone', 'red_sandstone', 'terracotta'
    ];

    return solidBlocks.includes(block.name) || 
           block.name.includes('planks') ||
           block.name.includes('log');
  }

  /**
   * Sort blocks by build order (layer by layer, bottom to top)
   */
  sortBlocksByBuildOrder(blocks, layerByLayer = true) {
    if (!layerByLayer) {
      return [...blocks];
    }

    return [...blocks].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return a.z - b.z;
    });
  }

  /**
   * Convert relative blueprint coordinates to world coordinates
   */
  relativeToWorld(block, originPos) {
    const origin = this.ensureVec3Floor(originPos);
    
    return new Vec3(
      origin.x + block.x,
      origin.y + block.y,
      origin.z + block.z
    );
  }

  /**
   * Check if block is available in inventory
   */
  async ensureBlockAvailable(blockName) {
    if (blockName.startsWith('wall_')) {
      blockName = blockName.replace('wall_', '');
    }

    const item = this.bot.inventory.items().find(i => i.name === blockName);
    return item !== undefined && item.count > 0;
  }

  /**
   * Get build progress
   */
  getBuildProgress() {
    if (!this.currentBuild) {
      return null;
    }

    const duration = (Date.now() - this.currentBuild.startTime) / 1000;
    const total = this.currentBuild.blueprint.totalBlocks;
    const completed = this.currentBuild.placedBlocks + this.currentBuild.skippedBlocks;
    const progress = (completed / total) * 100;

    return {
      placed: this.currentBuild.placedBlocks,
      failed: this.currentBuild.failedBlocks,
      skipped: this.currentBuild.skippedBlocks,
      cleared: this.currentBuild.clearedBlocks,
      total: total,
      completed: completed,
      progress: progress.toFixed(1),
      duration: duration.toFixed(1)
    };
  }

  /**
   * Abort current build
   */
  abortBuild() {
    if (this.currentBuild) {
      log('Aborting build...');
      this.aborted = true;
      return true;
    }
    return false;
  }

  /**
   * Preview build (check feasibility without building)
   */
  async previewBuild(blueprint, originPos) {
    log('Previewing build...');

    const origin = this.ensureVec3Floor(originPos);
    const issues = [];
    const warnings = [];

    const resourceReport = this.resourceCalculator.getResourceReport(blueprint);
    
    if (!resourceReport.hasAllResources) {
      issues.push({
        type: 'missing_resources',
        details: resourceReport.missing
      });
    }

    if (resourceReport.unsupported.length > 0) {
      warnings.push({
        type: 'unsupported_blocks',
        details: resourceReport.unsupported
      });
    }

    const canReach = this.blockPlacer.canReachPosition(origin);
    if (!canReach) {
      issues.push({
        type: 'unreachable_origin',
        details: 'Build location too far from bot'
      });
    }

    return {
      feasible: issues.length === 0,
      issues,
      warnings,
      resourceReport
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default BuildExecutor;