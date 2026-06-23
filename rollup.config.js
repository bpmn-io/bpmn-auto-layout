import resolve from '@rollup/plugin-node-resolve';

import fs from 'fs';
const pkg = importPkg();

export default [
  {
    input: 'lib/index.js',
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
    external: Object.keys(pkg.dependencies),
    plugins: [
      resolve()
    ]
  },
  {
    input: 'lib/index.js',
    output: {
      sourcemap: true,
      format: 'umd',
      name: 'BpmnAutoLayout',
      file: 'dist/bpmn-auto-layout.umd.js',
    },
    plugins: [
      resolve()
    ]
  },
  {
    input: 'lib/index.js',
    output: {
      sourcemap: true,
      format: 'iife',
      name: 'bpmnAutoLayout',
      file: 'dist/bpmn-auto-layout.iife.js',
    },
    plugins: [
      resolve()
    ]
  }
];

function importPkg() {
  return JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf8' }));
}