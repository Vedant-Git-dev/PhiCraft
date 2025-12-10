import { Vec3 } from 'vec3';
import { log, logSuccess, logWarning, logError } from '../utils/logger.js';
import SchematicLoader from '../utils/schematicLoader.js';
import ResourceCalculator from '../utils/resourceCalculator.js';
import BuildExecutor from '../utils/buildExecutor.js';

//   Load a blueprint from file
export async function loadBlueprint(bot, params) {
  const { filePath, saveJson = false } = params;

  log(`Loading blueprint: ${filePath}`);

  const loader = new SchematicLoader(bot);
  const blueprint = await loader.loadBlueprint(filePath);

  if (saveJson) {
    const jsonPath = filePath.replace(/\.(schematic|schem|nbt)$/, '.json');
    await loader.saveBlueprint(blueprint, jsonPath);
  }

  return {
    success: true,
    blueprint,
    size: blueprint.size,
    totalBlocks: blueprint.totalBlocks,
    blockTypes: Object.keys(blueprint.blockCounts).length
  };
}

/**
 * Calculate required materials for a blueprint
 * NOW INCLUDES GROUND PREPARATION MATERIALS
 */
export async function getRequiredMaterials(bot, params) {
  const { blueprint } = params;

  log('Calculating required materials...');

  const calculator = new ResourceCalculator(bot);
  const report = calculator.getResourceReport(blueprint);

  // Add extra materials for ground preparation
  const extraMaterials = estimateGroundPrepMaterials(blueprint);
  
  for (const [material, count] of Object.entries(extraMaterials)) {
    report.required[material] = (report.required[material] || 0) + count;
    
    const currentCount = bot.inventory.count(bot.registry.itemsByName[material]?.id || 0);
    const needed = report.required[material] - currentCount;
    
    if (needed > 0) {
      report.missing[material] = needed;
    }
  }

  return {
    success: true,
    required: report.required,
    missing: report.missing,
    available: report.available,
    hasAllResources: Object.keys(report.missing).length === 0,
    gatheringPlan: report.gatheringPlan,
    unsupported: report.unsupported
  };
}

/**
 * Estimate materials needed for ground preparation
 */
function estimateGroundPrepMaterials(blueprint) {
  const area = blueprint.size.x * blueprint.size.z;
  
  // Estimate: need dirt/cobblestone for foundation + clearing
  // Roughly 20% of area for foundation fill
  const foundationBlocks = Math.ceil(area * 0.2);
  
  return {
    'dirt': foundationBlocks
  };
}

/**
 * Build a structure from blueprint
 * NOW WITH AUTOMATIC GROUND PREP AND CLEARING
 */
export async function buildStructure(bot, params) {
  const { 
    blueprint, 
    position = null,
    layerByLayer = true,
    scaffolding = false,
    prepareGround = true,   // NEW: Enable by default
    clearArea = true        // NEW: Enable by default
  } = params;

  log(`Starting build operation...`);

  // Determine origin position
  let originPos;
  if (position) {
    originPos = new Vec3(position.x, position.y, position.z);
  } else {
    // Use bot's current position, but place slightly offset
    const botPos = bot.entity.position.floored();
    originPos = new Vec3(botPos.x + 2, botPos.y, botPos.z + 2);
  }

  log(`Build origin: (${originPos.x}, ${originPos.y}, ${originPos.z})`);

  // Check resources first
  const calculator = new ResourceCalculator(bot);
  const resourceReport = calculator.getResourceReport(blueprint);

  if (!resourceReport.hasAllResources) {
    logWarning('Missing required resources');
    return {
      success: false,
      status: 'missing_resources',
      required: resourceReport.required,
      missing: resourceReport.missing,
      message: 'Missing required building materials'
    };
  }

  // Execute build with ground prep
  const executor = new BuildExecutor(bot);
  
  const result = await executor.buildStructure(blueprint, originPos, {
    layerByLayer,
    scaffolding,
    prepareGround,    // Flatten and fill ground
    clearArea,        // Remove existing blocks
    progressCallback: (progress) => {
      if (progress.current % 20 === 0) {
        log(`Build progress: ${progress.current}/${progress.total} (${progress.placed} placed)`);
      }
    }
  });

  return result;
}

/**
 * Preview a build (check feasibility)
 */
export async function previewBuild(bot, params) {
  const { blueprint, position = null } = params;

  log('Previewing build...');

  let originPos;
  if (position) {
    originPos = new Vec3(position.x, position.y, position.z);
  } else {
    const botPos = bot.entity.position.floored();
    originPos = new Vec3(botPos.x + 2, botPos.y, botPos.z + 2);
  }

  const executor = new BuildExecutor(bot);
  const preview = await executor.previewBuild(blueprint, originPos);

  return {
    success: true,
    feasible: preview.feasible,
    issues: preview.issues,
    warnings: preview.warnings,
    resourceReport: preview.resourceReport
  };
}

/**
 * Abort current build
 */
export async function abortBuild(bot, params) {
  log('Aborting build...');

  const executor = new BuildExecutor(bot);
  const aborted = executor.abortBuild();

  return {
    success: aborted,
    message: aborted ? 'Build aborted' : 'No active build to abort'
  };
}

/**
 * Get build progress
 */
export async function getBuildProgress(bot, params) {
  const executor = new BuildExecutor(bot);
  const progress = executor.getBuildProgress();

  if (!progress) {
    return {
      success: false,
      message: 'No active build'
    };
  }

  return {
    success: true,
    progress
  };
}

/**
 * List available schematics
 */
export async function listSchematics(bot, params) {
  const { directory = './schematics' } = params;

  const loader = new SchematicLoader(bot);
  const schematics = await loader.listSchematics(directory);

  return {
    success: true,
    schematics,
    count: schematics.length
  };
}

export default {
  loadBlueprint,
  getRequiredMaterials,
  buildStructure,
  previewBuild,
  abortBuild,
  getBuildProgress,
  listSchematics
};