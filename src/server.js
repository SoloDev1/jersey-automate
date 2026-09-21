import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetFile = path.resolve(__dirname, '..', 'backend', 'src', 'server.ts');

console.log(`[Bootstrap] Booting Jersey Automate Backend Engine via tsx: ${targetFile}`);

const child = spawn('npx', ['tsx', targetFile], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
