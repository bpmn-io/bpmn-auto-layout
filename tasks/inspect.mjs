import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const npmExecPath = process.env.npm_execpath;
const inspectorPath = resolve('test', 'output', 'index.html');

if (!npmExecPath) {
  throw new Error('npm_execpath is required to run the inspector suite.');
}

const testExitCode = await run(process.execPath, [ npmExecPath, 'test' ]);

if (!existsSync(inspectorPath)) {
  console.error(`Inspector report was not created: ${inspectorPath}`);
  process.exitCode = testExitCode || 1;
} else {
  const openExitCode = await run(process.execPath, [ npmExecPath, 'exec', '--', 'open-cli', inspectorPath ]);

  process.exitCode = testExitCode || openExitCode;
}

function run(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'inherit' });

    child.on('exit', code => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}