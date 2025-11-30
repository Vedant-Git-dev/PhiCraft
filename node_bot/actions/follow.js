import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { log, logError, logSuccess } from '../utils/logger.js';

/**
 * Follow a player
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { playerName: string, distance: number }
 */
export async function follow(bot, params) {
  const { playerName, distance = 3 } = params;

  if (!playerName) {
    throw new Error('Player name is required');
  }

  log(`Following ${playerName} at distance ${distance}`);

  const player = bot.players[playerName]?.entity;
  
  if (!player) {
    throw new Error(`Player ${playerName} not found`);
  }

  logSuccess(`Found ${playerName}, starting to follow`);

  // Set follow goal
  const goal = new goals.GoalFollow(player, distance);
  bot.pathfinder.setGoal(goal, true);

  // Monitor following
  let lastPos = player.position.clone();
  const followInterval = setInterval(() => {
    if (!player.isValid) {
      clearInterval(followInterval);
      bot.pathfinder.setGoal(null);
      log(`Lost sight of ${playerName}`);
      return;
    }

    // Check if player moved significantly
    const currentPos = player.position;
    const moved = currentPos.distanceTo(lastPos);
    
    if (moved > 5) {
      log(`${playerName} moved, adjusting path`);
      lastPos = currentPos.clone();
    }

  }, 1000);

  return {
    success: true,
    message: `Following ${playerName}`,
    following: true
  };
}

/**
 * Stop following
 */
export function stopFollowing(bot) {
  bot.pathfinder.setGoal(null);
  log('Stopped following');
  
  return {
    success: true,
    message: 'Stopped following'
  };
}