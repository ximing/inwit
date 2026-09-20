/**
 * Inwit plugin for OpenCode.ai
 *
 * Registers the repository's skills/ directory via the config hook so
 * OpenCode discovers the inwit skill without symlinks or manual config edits.
 * Zero dependencies.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inwitSkillsDir = path.resolve(__dirname, '../../skills');

export const InwitPlugin = async () => {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(inwitSkillsDir)) {
        config.skills.paths.push(inwitSkillsDir);
      }
    },
  };
};
