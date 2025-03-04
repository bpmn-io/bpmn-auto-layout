import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

import fs from 'fs';
const pkg = importPkg();

export default {
  input: 'lib/index.js',
  output: [
    {
      sourcemap: true,
      format: 'esm',
      file: pkg.exports['.'].import,
      plugins: [ terser() ],
    },
    {
      sourcemap: true,
      format: 'cjs',
      file: pkg.exports['.'].require,
      plugins: [ terser() ],
    }
  ],
  external: Object.keys(pkg.dependencies),
  plugins: [
    resolve()
  ]
};

function importPkg() {
  return JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf8' }));
}