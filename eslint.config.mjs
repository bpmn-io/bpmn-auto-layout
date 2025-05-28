import { defineConfig } from 'eslint/config';

import bpmnIoPlugin from 'eslint-plugin-bpmn-io';

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
  })
]);