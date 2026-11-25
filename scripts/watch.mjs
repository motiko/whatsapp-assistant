// Rebuilds the extension whenever a source file changes. The loaded
// (unpacked) extension then reloads itself and WhatsApp Web within a few
// seconds (see src/extension/self-reload.ts). Usage: npm run watch
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';

const watched = ['src', 'wxt.config.ts', 'package.json'];
let timer;
let building = false;
let again = false;

function build() {
  if (building) {
    again = true;
    return;
  }
  building = true;
  const started = Date.now();
  const child = spawn('npx', ['wxt', 'build'], { stdio: ['ignore', 'ignore', 'inherit'] });
  child.on('exit', (code) => {
    building = false;
    const time = new Date().toLocaleTimeString();
    console.log(code === 0 ? `[${time}] built in ${Date.now() - started} ms` : `[${time}] build FAILED (exit ${code})`);
    if (again) {
      again = false;
      build();
    }
  });
}

for (const path of watched) {
  watch(path, { recursive: true }, (_event, file) => {
    if (file && /\.test\.ts$|(^|\/)\.|fixtures\//.test(file)) return; // tests and snapshots aren't in the build
    clearTimeout(timer);
    timer = setTimeout(build, 300);
  });
}
console.log(`Watching ${watched.join(', ')}; rebuilding on change. Ctrl+C to stop.`);
build();
