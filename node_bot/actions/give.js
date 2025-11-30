import { giveItemsToPlayer } from '../utils/inventory.js';
import { log, logSuccess } from '../utils/logger.js';

/**
 * Give items to a player
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { playerName: string, itemName: string, count: number }
 */
export async function give(bot, params) {
  const { playerName, itemName, count } = params;

  if (!playerName) {
    throw new Error('Player name is required');
  }

  log(`Giving ${itemName || 'all items'} to ${playerName}`);

  const result = await giveItemsToPlayer(bot, playerName, itemName, count);

  return result;
}