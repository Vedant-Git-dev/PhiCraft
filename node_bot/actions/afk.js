import { log, logSuccess } from '../utils/logger.js';

/**
 * AFK mode - keep bot active
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { duration: number }
 */
export async function afk(bot, params) {
  const { duration = 60 } = params; // duration in seconds

  log(`Entering AFK mode for ${duration} seconds`);

  const startTime = Date.now();
  const endTime = startTime + (duration * 1000);

  // Simple movement to prevent being kicked
  const afkInterval = setInterval(() => {
    if (Date.now() >= endTime) {
      clearInterval(afkInterval);
      logSuccess('AFK mode ended');
      return;
    }

    // Random small movements
    const actions = [
      () => bot.look(bot.entity.yaw + 0.1, bot.entity.pitch),
      () => bot.look(bot.entity.yaw - 0.1, bot.entity.pitch),
      () => bot.setControlState('jump', true),
      () => bot.setControlState('jump', false)
    ];

    const randomAction = actions[Math.floor(Math.random() * actions.length)];
    randomAction();

  }, 5000); // Every 5 seconds

  return new Promise((resolve) => {
    setTimeout(() => {
      clearInterval(afkInterval);
      resolve({
        success: true,
        message: `AFK mode completed (${duration}s)`
      });
    }, duration * 1000);
  });
}