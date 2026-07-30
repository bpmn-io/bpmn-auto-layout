import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

import fs from 'fs';

const pkg = importPkg();
const dependencies = Object.keys(pkg.dependencies);

export default [
  {
    input: 'lib/index.ts',
    output: [
      {
        sourcemap: true,
        format: 'esm',
        file: pkg.exports['.'].import,
      },
      {
        sourcemap: true,
        format: 'cjs',
        file: pkg.exports['.'].require,
      }
    ],
    external: dependencies,
    plugins: [
      resolve(),
      typescript({ tsconfig: './tsconfig.rollup.json' })
    ]
  },
  {
    input: 'bin/bpmn-auto-layout.ts',
    output: {
      banner: '#!/usr/bin/env node',
      sourcemap: true,
      format: 'esm',
      file: pkg.bin['bpmn-auto-layout']
    },
    external: dependencies,
    plugins: [
      builtPublicApi(),
      resolve(),
      typescript({ tsconfig: './tsconfig.rollup.json' })
    ]
  }
];

function importPkg() {
  return JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf8' }));
}

function builtPublicApi() {
  return {
    name: 'built-public-api',
    resolveId(source) {
      if (source === '../lib/index.js') {
        return {
          id: './index.js',
          external: true
        };
      }
    }
  };
}