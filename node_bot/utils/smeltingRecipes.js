export const SMELTING_RECIPES = {
  // Ores to Ingots
  'iron_ingot': {
    input: 'raw_iron',
    alternative_inputs: ['iron_ore', 'deepslate_iron_ore'],
    time: 10000, // 10 seconds in ms
    experience: 0.7
  },
  'gold_ingot': {
    input: 'raw_gold',
    alternative_inputs: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
    time: 10000,
    experience: 1.0
  },
  'copper_ingot': {
    input: 'raw_copper',
    alternative_inputs: ['copper_ore', 'deepslate_copper_ore'],
    time: 10000,
    experience: 0.7
  },
  'netherite_scrap': {
    input: 'ancient_debris',
    time: 10000,
    experience: 2.0
  },
  
  // Stone and Glass
  'glass': {
    input: 'sand',
    time: 10000,
    experience: 0.1
  },
  'smooth_stone': {
    input: 'stone',
    time: 10000,
    experience: 0.1
  },
  'terracotta': {
    input: 'clay',
    time: 10000,
    experience: 0.35
  },
  
  // Food
  'cooked_beef': {
    input: 'beef',
    time: 10000,
    experience: 0.35
  },
  'cooked_porkchop': {
    input: 'porkchop',
    time: 10000,
    experience: 0.35
  },
  'cooked_chicken': {
    input: 'chicken',
    time: 10000,
    experience: 0.35
  },
  'cooked_mutton': {
    input: 'mutton',
    time: 10000,
    experience: 0.35
  },
  'cooked_cod': {
    input: 'cod',
    time: 10000,
    experience: 0.35
  },
  'cooked_salmon': {
    input: 'salmon',
    time: 10000,
    experience: 0.35
  },
  'baked_potato': {
    input: 'potato',
    time: 10000,
    experience: 0.35
  },
  
  // Wood to Charcoal
  'charcoal': {
    input: 'oak_log',
    alternative_inputs: ['spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'],
    time: 10000,
    experience: 0.15
  },
  
  // Misc
  'brick': {
    input: 'clay_ball',
    time: 10000,
    experience: 0.3
  },
  'nether_brick': {
    input: 'netherrack',
    time: 10000,
    experience: 0.1
  },
  'green_dye': {
    input: 'cactus',
    time: 10000,
    experience: 1.0
  }
};

/**
 * Fuel values in ticks (20 ticks = 1 second)
 * Higher value = burns longer
 */
export const FUEL_VALUES = {
  // Best fuels
  'lava_bucket': 20000,
  'coal_block': 16000,
  'dried_kelp_block': 4000,
  
  // Good fuels
  'blaze_rod': 2400,
  'coal': 1600,
  'charcoal': 1600,
  
  // Decent fuels
  'oak_log': 300,
  'spruce_log': 300,
  'birch_log': 300,
  'jungle_log': 300,
  'acacia_log': 300,
  'dark_oak_log': 300,
  'mangrove_log': 300,
  'stripped_oak_log': 300,
  'stripped_spruce_log': 300,
  'stripped_birch_log': 300,
  'stripped_jungle_log': 300,
  'stripped_acacia_log': 300,
  'stripped_dark_oak_log': 300,
  
  // Low-tier fuels
  'oak_planks': 300,
  'spruce_planks': 300,
  'birch_planks': 300,
  'jungle_planks': 300,
  'acacia_planks': 300,
  'dark_oak_planks': 300,
  'mangrove_planks': 300,
  
  // Emergency fuels
  'stick': 100,
  'wooden_pickaxe': 200,
  'wooden_axe': 200,
  'wooden_shovel': 200,
  'wooden_sword': 200,
  'wooden_hoe': 200,
  'bowl': 100,
  'wooden_door': 200,
  'fence': 300,
  'fence_gate': 300
};

/**
 * Fuel priority order (best to worst)
 */
export const FUEL_PRIORITY = [
  'coal',
  'charcoal',
  'coal_block',
  'dried_kelp_block',
  'blaze_rod',
  'oak_log',
  'spruce_log',
  'birch_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'oak_planks',
  'spruce_planks',
  'birch_planks',
  'jungle_planks',
  'acacia_planks',
  'dark_oak_planks',
  'stick'
];

/**
 * Check if an item can be smelted
 */
export function isSmeltable(itemName) {
  return itemName in SMELTING_RECIPES;
}

/**
 * Get the input item needed to smelt an output item
 */
export function getSmeltingInput(outputItem) {
  const recipe = SMELTING_RECIPES[outputItem];
  if (!recipe) return null;
  return recipe.input;
}

/**
 * Get all possible inputs for smelting (including alternatives)
 */
export function getAllSmeltingInputs(outputItem) {
  const recipe = SMELTING_RECIPES[outputItem];
  if (!recipe) return [];
  
  const inputs = [recipe.input];
  if (recipe.alternative_inputs) {
    inputs.push(...recipe.alternative_inputs);
  }
  return inputs;
}

/**
 * Get reverse mapping: what can this input produce?
 */
export function getSmeltingOutput(inputItem) {
  for (const [output, recipe] of Object.entries(SMELTING_RECIPES)) {
    if (recipe.input === inputItem) {
      return output;
    }
    if (recipe.alternative_inputs && recipe.alternative_inputs.includes(inputItem)) {
      return output;
    }
  }
  return null;
}

/**
 * Check if an item can be used as fuel
 */
export function isFuel(itemName) {
  return itemName in FUEL_VALUES;
}

/**
 * Get fuel value in ticks
 */
export function getFuelValue(itemName) {
  return FUEL_VALUES[itemName] || 0;
}

/**
 * Calculate how many items can be smelted with given fuel
 */
export function calculateSmeltableItems(fuelName, fuelCount) {
  const fuelValue = getFuelValue(fuelName);
  const totalTicks = fuelValue * fuelCount;
  // Each item takes 200 ticks (10 seconds) to smelt
  return Math.floor(totalTicks / 200);
}

/**
 * Calculate minimum fuel needed for smelting count items
 */
export function calculateFuelNeeded(fuelName, itemCount) {
  const ticksNeeded = itemCount * 200; // 200 ticks per item
  const fuelValue = getFuelValue(fuelName);
  if (fuelValue === 0) return Infinity;
  return Math.ceil(ticksNeeded / fuelValue);
}

export default {
  SMELTING_RECIPES,
  FUEL_VALUES,
  FUEL_PRIORITY,
  isSmeltable,
  getSmeltingInput,
  getAllSmeltingInputs,
  getSmeltingOutput,
  isFuel,
  getFuelValue,
  calculateSmeltableItems,
  calculateFuelNeeded
};