import { log, logSuccess } from '../utils/logger.js';
import SmeltingManager from '../utils/smeltingManager.js';

/**
 * Smelt action - Main entry point for smelting operations
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { itemName: string, count: number }
 */
export async function smelt(bot, params) {
  const { itemName, count = 1 } = params;

  log(`Smelt action: ${count}x ${itemName}`);

  const smeltingManager = new SmeltingManager(bot);
  const result = await smeltingManager.smeltItem(itemName, count);

  return result;
}

export default { smelt };