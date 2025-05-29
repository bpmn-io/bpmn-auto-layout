import { defineConfig } from 'eslint/config';

import bpmnIoPlugin from 'eslint-plugin-bpmn-io';
import html from "@html-eslint/eslint-plugin";

export default defineConfig([
  {
    ignores: [ 'node_modules/**/*', 'dist/**/*', 'example/dist/**/*' ],
  },
  {
    ...html.configs["flat/recommended"],
    files: ["**/*.html"],
    rules: {
      ...html.configs["flat/recommended"].rules, // Must be defined. If not, all recommended rules will be lost
      "@html-eslint/indent": ["error", 2],
    },
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