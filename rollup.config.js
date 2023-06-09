import fs from 'fs';
const pkg = importPkg();

export default {
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
  external: Object.keys(pkg.dependencies)
};

function importPkg() {
  return JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf8' }));
}