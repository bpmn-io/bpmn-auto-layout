import { defineConfig } from 'eslint/config';

import bpmnIoPlugin from 'eslint-plugin-bpmn-io';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: [ 'node_modules/**/*', 'dist/**/*', 'example/dist/**/*' ],
  },
  ...bpmnIoPlugin.configs.browser.map(config => {
    return {
      ...config,
      files: ['lib/**/*', 'example/src/**/*']
    }
  }),
  ...bpmnIoPlugin.configs.mocha.map(config => {
    return {
      ...config,
      files: [
        'test/**/*',
      ]
    };
  }),
  ...tseslint.configs.recommended.map(config => {
    return {
      ...config,
      files: [ '**/*.ts' ]
    };
  })
]);