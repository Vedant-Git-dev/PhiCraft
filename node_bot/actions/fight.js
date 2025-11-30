import pathfinderPlugin from 'mineflayer-pathfinder';
const { goals } = pathfinderPlugin;
import { log, logError, logSuccess } from '../utils/logger.js';

/**
 * Attack nearby mobs
 * @param {Object} bot - Mineflayer bot instance
 * @param {Object} params - { mobType: string, radius: number }
 */
export async function fight(bot, params) {
  const { mobType = 'all', radius = 16 } = params;

  log(`Starting combat mode (target: ${mobType}, radius: ${radius})`);

  // Equip weapon
  await equipWeapon(bot);

  let killCount = 0;
  const startTime = Date.now();
  const maxDuration = 60000; // 1 minute max

  while (Date.now() - startTime < maxDuration) {
    try {
      // Find nearest hostile mob or specified target
      const mob = findNearestMob(bot, mobType, radius);

      if (!mob) {
        log('No targets found');
        break;
      }

      const mobName = mob.name || mob.displayName || 'mob';
      log(`Engaging ${mobName} at distance ${bot.entity.position.distanceTo(mob.position).toFixed(1)}`);

      // Attack the mob
      await attackEntity(bot, mob);
      killCount++;
      logSuccess(`Defeated ${mobName} (${killCount} kills)`);

      // Small delay before looking for next target
      await sleep(500);

    } catch (error) {
      if (error.message.includes('dead') || error.message.includes('valid')) {
        log(`Target eliminated`);
        continue;
      }
      logError(`Combat error: ${error.message}`);
      break;
    }

    // Check health
    if (bot.health < 10) {
      log('Low health, retreating...');
      break;
    }
  }

  return {
    success: true,
    killCount,
    message: `Combat ended. Defeated ${killCount} mob(s)`
  };
}

/**
 * Find nearest mob to attack
 */
function findNearestMob(bot, mobType, radius) {
  const hostileMobs = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 
                       'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
                       'cave_spider', 'silverfish', 'vindicator', 'evoker', 'pillager'];
  
  let nearestMob = null;
  let nearestDistance = radius;

  for (const entityId in bot.entities) {
    const entity = bot.entities[entityId];
    
    // Skip invalid entities
    if (!entity || !entity.position || entity === bot.entity) continue;
    
    // Calculate distance
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > radius) continue;

    // Check mob type
    const entityName = entity.name || entity.displayName || '';
    
    // If specific mob requested
    if (mobType !== 'all') {
      if (entityName.toLowerCase().includes(mobType.toLowerCase())) {
        if (distance < nearestDistance) {
          nearestMob = entity;
          nearestDistance = distance;
        }
      }
      continue;
    }

    // For 'all', target hostile mobs only
    const isHostile = hostileMobs.some(hostile => 
      entityName.toLowerCase().includes(hostile.toLowerCase())
    );

    if (isHostile && distance < nearestDistance) {
      nearestMob = entity;
      nearestDistance = distance;
    }
  }

  return nearestMob;
}

/**
 * Attack a specific entity
 */
async function attackEntity(bot, entity) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      bot.pathfinder.setGoal(null);
      reject(new Error('Attack timeout'));
    }, 30000);

    let lastHealth = entity.health || 20;
    let stuckCount = 0;

    try {
      const attackInterval = setInterval(async () => {
        // Check if entity is still valid and alive
        if (!entity || !entity.isValid || !entity.position) {
          clearInterval(attackInterval);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
          return;
        }

        try {
          const distance = bot.entity.position.distanceTo(entity.position);

          // If too far, move closer
          if (distance > 3.5) {
            const goal = new goals.GoalFollow(entity, 2);
            bot.pathfinder.setGoal(goal, true);
          } else {
            // Stop moving and attack
            bot.pathfinder.setGoal(null);
            
            // Look at entity
            await bot.lookAt(entity.position.offset(0, entity.height * 0.5, 0));
            
            // Attack
            await bot.attack(entity);
          }

          // Check if we're making progress
          if (entity.health && entity.health < lastHealth) {
            lastHealth = entity.health;
            stuckCount = 0;
          } else {
            stuckCount++;
            if (stuckCount > 20) {
              // Not making progress for 10 seconds
              clearInterval(attackInterval);
              clearTimeout(timeout);
              bot.pathfinder.setGoal(null);
              reject(new Error('Cannot damage target'));
              return;
            }
          }

        } catch (err) {
          // Entity might have died or become invalid
          if (!entity.isValid) {
            clearInterval(attackInterval);
            clearTimeout(timeout);
            bot.pathfinder.setGoal(null);
            resolve();
          }
        }
      }, 500);

    } catch (error) {
      clearTimeout(timeout);
      bot.pathfinder.setGoal(null);
      reject(error);
    }
  });
}

/**
 * Equip best weapon
 */
async function equipWeapon(bot) {
  const weapons = bot.inventory.items().filter(item => {
    return item.name.includes('sword') || item.name.includes('axe');
  });

  if (weapons.length === 0) {
    log('No weapon found, using fists');
    return;
  }

  // Prefer diamond > iron > stone > wood
  const materialOrder = ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'golden'];
  
  let bestWeapon = weapons[0];
  let bestScore = -1;

  for (const weapon of weapons) {
    // Prefer swords over axes
    let score = weapon.name.includes('sword') ? 100 : 50;
    
    // Add material bonus
    for (let i = 0; i < materialOrder.length; i++) {
      if (weapon.name.includes(materialOrder[i])) {
        score += (materialOrder.length - i) * 10;
        break;
      }
    }

    if (score > bestScore) {
      bestWeapon = weapon;
      bestScore = score;
    }
  }

  try {
    await bot.equip(bestWeapon, 'hand');
    log(`Equipped ${bestWeapon.name}`);
  } catch (error) {
    logError(`Failed to equip weapon: ${error.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}