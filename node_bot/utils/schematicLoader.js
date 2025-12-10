import fs from 'fs/promises';
import path from 'path';
import prismarineSchematic from 'prismarine-schematic';
import minecraftData from 'minecraft-data';
import { log, logError, logSuccess, logWarning } from './logger.js';
import { Vec3 } from 'vec3';

/**
 * Schematic Loader - Loads and parses .schematic files
 */

class SchematicLoader {
  constructor(bot) {
    this.bot = bot;
    this.mcData = minecraftData(bot.version);
    this.mcVersion = bot.version;
  }

  /**
   * Load schematic file from disk
   */
  async loadSchematicFile(filePath) {
    log(`Loading schematic file: ${filePath}`);

    try {
      // Check if file exists
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        throw new Error(`${filePath} is not a file`);
      }

      // Read file
      const schematicData = await fs.readFile(filePath);
      log(`Read ${schematicData.length} bytes from ${filePath}`);

      // Parse schematic
      const schematic = await prismarineSchematic.Schematic.read(
        schematicData,
        this.mcVersion
      );

      logSuccess(`Loaded schematic: ${schematic.size.x}x${schematic.size.y}x${schematic.size.z}`);

      return schematic;

    } catch (error) {
      logError(`Failed to load schematic: ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert schematic to blueprint format
   */
  async schematicToBlueprint(schematic) {
    log('Converting schematic to blueprint format...');
    
    const blueprint = {
      size: {
        x: schematic.size.x,
        y: schematic.size.y,
        z: schematic.size.z
      },
      blocks: [],
      blockCounts: {},
      totalBlocks: 0
    };

    // Iterate through all positions in schematic
    for (let y = 0; y < schematic.size.y; y++) {
      for (let x = 0; x < schematic.size.x; x++) {
        for (let z = 0; z < schematic.size.z; z++) {
          
          const block = schematic.getBlock(new Vec3(x, y, z));
          
          // Skip air blocks
          if (!block || block.name === 'air') {
            continue;
          }

          // Create block entry
          const blockEntry = {
            x: x,
            y: y,
            z: z,
            name: block.name,
            blockId: block.stateId || block.type,
            properties: block.getProperties ? block.getProperties() : {}
          };
          
          blueprint.blocks.push(blockEntry);

          // Count blocks
          const blockName = block.name;
          blueprint.blockCounts[blockName] = (blueprint.blockCounts[blockName] || 0) + 1;
          blueprint.totalBlocks++;
        }
      }
    }

    logSuccess(`Blueprint created: ${blueprint.totalBlocks} blocks, ${Object.keys(blueprint.blockCounts).length} types`);

    return blueprint;
  }

  /**
   * Load schematic and convert to blueprint in one call
   */
  async loadBlueprint(filePath) {
    log(`\n=== LOADING BLUEPRINT: ${filePath} ===`);

    const schematic = await this.loadSchematicFile(filePath);
    const blueprint = await this.schematicToBlueprint(schematic);

    log(`Blueprint summary:`);
    log(`  Size: ${blueprint.size.x}x${blueprint.size.y}x${blueprint.size.z}`);
    log(`  Total blocks: ${blueprint.totalBlocks}`);
    log(`  Block types: ${Object.keys(blueprint.blockCounts).length}`);
    log(`  Top 5 blocks:`);
    
    const sortedBlocks = Object.entries(blueprint.blockCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    sortedBlocks.forEach(([name, count]) => {
      log(`    ${name}: ${count}`);
    });

    logSuccess(`=== BLUEPRINT LOADED ===\n`);

    return blueprint;
  }

  /**
   * Save blueprint to JSON file
   */
  async saveBlueprint(blueprint, outputPath) {
    log(`Saving blueprint to ${outputPath}...`);

    try {
      const jsonData = JSON.stringify(blueprint, null, 2);
      await fs.writeFile(outputPath, jsonData, 'utf8');
      logSuccess(`Blueprint saved to ${outputPath}`);
    } catch (error) {
      logError(`Failed to save blueprint: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load blueprint from JSON file
   */
  async loadBlueprintFromJson(filePath) {
    log(`Loading blueprint from JSON: ${filePath}`);

    try {
      const jsonData = await fs.readFile(filePath, 'utf8');
      const blueprint = JSON.parse(jsonData);
      logSuccess(`Blueprint loaded from JSON`);
      return blueprint;
    } catch (error) {
      logError(`Failed to load JSON blueprint: ${error.message}`);
      throw error;
    }
  }

  /**
   * List available schematics in directory
   */
  async listSchematics(directory) {
    log(`Listing schematics in ${directory}...`);

    try {
      const files = await fs.readdir(directory);
      const schematics = files.filter(file => 
        file.endsWith('.schematic') || 
        file.endsWith('.schem') || 
        file.endsWith('.nbt')
      );

      log(`Found ${schematics.length} schematic files`);
      return schematics;

    } catch (error) {
      logError(`Failed to list schematics: ${error.message}`);
      return [];
    }
  }
}

export default SchematicLoader;