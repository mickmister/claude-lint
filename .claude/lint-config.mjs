import {defineLintConfig} from '../dist/index.js';

import defaultConfig, {
  extraValidators,
} from '../dist/lint-config.default.mjs';

export default defineLintConfig({
  validators: [
    ...defaultConfig.validators,
    ...extraValidators,
  ],
  debug: true,
});
