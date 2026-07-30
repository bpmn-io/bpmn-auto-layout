import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

import fs from 'fs';
const pkg = importPkg();

export default {
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
  external: Object.keys(pkg.dependencies),
  plugins: [
    resolve(),
    typescript({ tsconfig: './tsconfig.rollup.json' })
  ]
};

function importPkg() {
  return JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf8' }));
}