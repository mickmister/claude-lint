import {defineLintConfig} from '../dist';

import defaultConfig, {noCommentsRule, noCommentsRuleBash} from '../dist/lint-config.default.mjs';

export default defineLintConfig({
  validators: [
    ...defaultConfig.validators,
    noCommentsRule,
    noCommentsRuleBash,
  ],
  debug: true,
});
