import { log, logWarning, logSuccess, logError } from './logger.js';

/**
 * Tool Validator - SUPER DEBUG VERSION
 * This version has extensive logging to help diagnose tool detection issues
 */

const TIER_ORDER = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];

const BLOCK_TOOL_REQUIREMENTS = {
  // No tool required
  'dirt': { tier: 'none', tool: 'any' },
  'grass_block': { tier: 'none', tool: 'any' },
  'sand': { tier: 'none', tool: 'any' },
  'gravel': { tier: 'none', tool: 'any' },
  
  // Wood blocks
  'oak_log': { tier: 'none', tool: 'axe' },
  'spruce_log': { tier: 'none', tool: 'axe' },
  'birch_log': { tier: 'none', tool: 'axe' },
  'jungle_log': { tier: 'none', tool: 'axe' },
  'acacia_log': { tier: 'none', tool: 'axe' },
  'dark_oak_log': { tier: 'none', tool: 'axe' },
  
  // Wooden pickaxe or better
  'stone': { tier: 'wooden', tool: 'pickaxe' },
  'cobblestone': { tier: 'wooden', tool: 'pickaxe' },
  'coal_ore': { tier: 'wooden', tool: 'pickaxe' },
  'deepslate_coal_ore': { tier: 'wooden', tool: 'pickaxe' },
  
  // Stone pickaxe or better
  'iron_ore': { tier: 'stone', tool: 'pickaxe' },
  'deepslate_iron_ore': { tier: 'stone', tool: 'pickaxe' },
  'lapis_ore': { tier: 'stone', tool: 'pickaxe' },
  'deepslate_lapis_ore': { tier: 'stone', tool: 'pickaxe' },
  'copper_ore': { tier: 'stone', tool: 'pickaxe' },
  'deepslate_copper_ore': { tier: 'stone', tool: 'pickaxe' },
  
  // Iron pickaxe or better
  'gold_ore': { tier: 'iron', tool: 'pickaxe' },
  'deepslate_gold_ore': { tier: 'iron', tool: 'pickaxe' },
  'diamond_ore': { tier: 'iron', tool: 'pickaxe' },
  'deepslate_diamond_ore': { tier: 'iron', tool: 'pickaxe' },
  'redstone_ore': { tier: 'iron', tool: 'pickaxe' },
  'deepslate_redstone_ore': { tier: 'iron', tool: 'pickaxe' },
  'emerald_ore': { tier: 'iron', tool: 'pickaxe' },
  'deepslate_emerald_ore': { tier: 'iron', tool: 'pickaxe' },
  
  // Diamond pickaxe or better
  'obsidian': { tier: 'diamond', tool: 'pickaxe' },
  'ancient_debris': { tier: 'diamond', tool: 'pickaxe' },
  'crying_obsidian': { tier: 'diamond', tool: 'pickaxe' }
};

/**
 * Get required tool tier for mining a block
 */
export function getRequiredToolTier(blockName) {
  const requirement = BLOCK_TOOL_REQUIREMENTS[blockName];
  
  if (!requirement) {
    log(`⚠️ No requirement found for ${blockName}, assuming 'none'`);
    return { tier: 'none', tool: 'any' };
  }
  
  log(`📋 Requirement for ${blockName}: ${requirement.tier} ${requirement.tool}`);
  return requirement;
}

/**
 * Check if player has adequate tool for mining
 * SUPER DEBUG VERSION with extensive logging
 */
export function hasAdequateTool(bot, blockName) {
  log(`\n🔍 === TOOL CHECK DEBUG FOR ${blockName} ===`);
  
  const requirement = getRequiredToolTier(blockName);
  
  // No tool required
  if (requirement.tier === 'none') {
    log(`✓ No tool required for ${blockName}`);
    log(`🔍 ================================\n`);
    return { 
      hasTooling: true, 
      toolName: 'hand',
      equipped: null
    };
  }

  const requiredTierIndex = TIER_ORDER.indexOf(requirement.tier);
  log(`📊 Required tier index: ${requiredTierIndex} (${requirement.tier})`);
  
  if (requiredTierIndex === -1) {
    logError(`❌ Invalid tier: ${requirement.tier}`);
    log(`🔍 ================================\n`);
    return { 
      hasTooling: false, 
      toolName: null,
      equipped: null,
      requiredTier: requirement.tier,
      requiredTool: `${requirement.tier}_${requirement.tool}`
    };
  }

  // Get ALL items in inventory
  const allItems = bot.inventory.items();
  log(`📦 Total items in inventory: ${allItems.length}`);
  
  // Log ALL items for debugging
  log(`📦 Full inventory:`);
  allItems.forEach(item => {
    log(`   - ${item.name} x${item.count} (id: ${item.type})`);
  });

  // Filter for the required tool type
  const toolType = requirement.tool;
  log(`\n🔧 Looking for tool type: ${toolType}`);
  
  const matchingTools = allItems.filter(item => {
    const matches = item.name.includes(toolType);
    log(`   Checking ${item.name}: ${matches ? '✓ MATCH' : '✗ no match'}`);
    return matches;
  });
  
  log(`\n🔧 Found ${matchingTools.length} ${toolType}(s):`);
  matchingTools.forEach(tool => {
    log(`   - ${tool.name}`);
  });

  if (matchingTools.length === 0) {
    logError(`❌ No ${toolType} found in inventory!`);
    log(`🔍 ================================\n`);
    return { 
      hasTooling: false, 
      toolName: null,
      equipped: null,
      requiredTier: requirement.tier,
      requiredTool: `${requirement.tier}_${toolType}`
    };
  }

  // Check each tool's tier
  let bestTool = null;
  let bestTierIndex = -1;

  log(`\n🎯 Checking tool tiers (need ${requirement.tier} or better):`);
  
  for (const tool of matchingTools) {
    log(`   Checking ${tool.name}...`);
    
    // Check each possible tier
    for (let i = 0; i < TIER_ORDER.length; i++) {
      const tier = TIER_ORDER[i];
      const hasTier = tool.name.includes(tier);
      
      if (hasTier) {
        log(`      Found tier: ${tier} (index ${i})`);
        
        if (i >= requiredTierIndex) {
          log(`      ✓ Meets requirement! (${i} >= ${requiredTierIndex})`);
          
          if (bestTool === null || i > bestTierIndex) {
            bestTool = tool;
            bestTierIndex = i;
            log(`      ✓✓ NEW BEST TOOL: ${tool.name}`);
          }
        } else {
          log(`      ✗ Too low tier (${i} < ${requiredTierIndex})`);
        }
        break;
      }
    }
  }

  log(`\n🏆 Final result:`);
  if (bestTool) {
    logSuccess(`   ✓ Best tool: ${bestTool.name} (tier: ${TIER_ORDER[bestTierIndex]})`);
    log(`🔍 ================================\n`);
    return { 
      hasTooling: true, 
      toolName: bestTool.name,
      equipped: bestTool
    };
  } else {
    logError(`   ❌ No adequate tool found`);
    log(`   Need: ${requirement.tier} ${toolType} or better`);
    log(`   Have: ${matchingTools.map(t => t.name).join(', ')}`);
    log(`🔍 ================================\n`);
    return { 
      hasTooling: false, 
      toolName: null,
      equipped: null,
      requiredTier: requirement.tier,
      requiredTool: `${requirement.tier}_${toolType}`
    };
  }
}

/**
 * Get best tool from inventory for a block
 */
export function getBestToolForBlock(bot, blockName) {
  const requirement = getRequiredToolTier(blockName);
  
  if (requirement.tier === 'none') {
    if (requirement.tool !== 'any') {
      const tools = bot.inventory.items().filter(item => 
        item.name.includes(requirement.tool)
      );
      if (tools.length > 0) {
        return selectBestTool(tools);
      }
    }
    return null;
  }

  const tools = bot.inventory.items().filter(item => 
    item.name.includes(requirement.tool)
  );

  return selectBestTool(tools);
}

/**
 * Select best tool from list based on tier
 */
function selectBestTool(tools) {
  if (tools.length === 0) return null;

  let bestTool = tools[0];
  let bestScore = getTierScore(bestTool.name);

  for (const tool of tools) {
    const score = getTierScore(tool.name);
    if (score > bestScore) {
      bestTool = tool;
      bestScore = score;
    }
  }

  return bestTool;
}

/**
 * Get tier score for sorting
 */
function getTierScore(itemName) {
  for (let i = 0; i < TIER_ORDER.length; i++) {
    if (itemName.includes(TIER_ORDER[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Validate if bot can mine with current inventory
 */
export function validateMiningCapability(bot, blockName) {
  const toolCheck = hasAdequateTool(bot, blockName);
  const requirement = getRequiredToolTier(blockName);
  
  return {
    canMine: toolCheck.hasTooling,
    currentTool: toolCheck.toolName,
    requiredTier: requirement.tier,
    requiredTool: toolCheck.requiredTool,
    needsCrafting: !toolCheck.hasTooling
  };
}

/**
 * Log tool requirement info
 */
export function logToolRequirement(blockName) {
  const requirement = getRequiredToolTier(blockName);
  
  if (requirement.tier === 'none') {
    log(`ℹ️  ${blockName} can be mined with hand`);
  } else {
    log(`ℹ️  ${blockName} requires ${requirement.tier} ${requirement.tool} or better`);
  }
}

/**
 * List all tools in inventory for debugging
 */
export function listInventoryTools(bot) {
  const tools = bot.inventory.items().filter(item => 
    item.name.includes('pickaxe') || 
    item.name.includes('axe') || 
    item.name.includes('shovel') ||
    item.name.includes('hoe')
  );
  
  if (tools.length === 0) {
    log('❌ No tools in inventory');
    return;
  }
  
  log(`🔧 Tools in inventory (${tools.length}):`);
  tools.forEach(tool => {
    log(`   - ${tool.name} x${tool.count}`);
  });
}

export default {
  getRequiredToolTier,
  hasAdequateTool,
  getBestToolForBlock,
  validateMiningCapability,
  logToolRequirement,
  listInventoryTools,
  TIER_ORDER
};