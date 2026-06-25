#!/usr/bin/env node
/**
 * Interactive dev launcher for the monorepo.
 *
 *   npm run dev            -> arrow-key menu to pick which apps to run together
 *   npm run dev all        -> run a preset directly (skips the menu)
 *   npm run dev admin      -> alias of "admin + backend"
 *   npm run dev -- --dry all   -> print what would run, then exit (no spawning)
 *
 * Zero dependencies: the menu uses raw-mode stdin; apps run via `npm run dev` per app
 * with colour-prefixed, interleaved output. Ctrl+C stops everything.
 */
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  invert: '\x1b[7m',
};

// App registry: dir + label colour + dev port.
const APPS = {
  backend: { dir: 'apps/backend', color: c.cyan, port: 4000 },
  admin: { dir: 'apps/admin', color: c.magenta, port: 5173 },
  user: { dir: 'apps/user', color: c.green, port: 5174 },
  scanner: { dir: 'apps/scanner', color: c.yellow, port: 5175 },
};

// Selectable presets (backend is included with each app since the apps need the API).
const PRESETS = [
  { key: 'all', label: 'All apps  (backend + admin + user + scanner)', apps: ['backend', 'admin', 'user', 'scanner'] },
  { key: 'admin', label: 'Admin + Backend', apps: ['backend', 'admin'] },
  { key: 'user', label: 'User + Backend', apps: ['backend', 'user'] },
  { key: 'scanner', label: 'Scanner + Backend', apps: ['backend', 'scanner'] },
  { key: 'backend', label: 'Backend only', apps: ['backend'] },
];

function portsLine(apps) {
  return apps
    .map((a) => `${APPS[a].color}${a}${c.reset} ${c.gray}:${APPS[a].port}${c.reset}`)
    .join('  ');
}

// First-run convenience: create apps/backend/.env from the example so the API can boot,
// and remind the operator that the backend needs a running MongoDB (replica set).
function ensureBackendEnv() {
  const envPath = join(ROOT, 'apps/backend/.env');
  const examplePath = join(ROOT, 'apps/backend/.env.example');
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log(`${c.yellow}Created apps/backend/.env from .env.example${c.reset}`);
  }
  console.log(
    `${c.gray}Backend needs MongoDB (replica set) — set MONGO_URI in apps/backend/.env ` +
      `(Atlas, or a local --replSet mongod).${c.reset}`,
  );
}

// ---- Launch selected apps -------------------------------------------------
function run(apps) {
  if (apps.includes('backend')) ensureBackendEnv();
  console.log(`\n${c.bold}Starting:${c.reset} ${portsLine(apps)}\n`);
  const children = [];
  let shuttingDown = false;

  const labelWidth = Math.max(...apps.map((a) => a.length));

  for (const name of apps) {
    const { dir, color } = APPS[name];
    const child = spawn('npm', ['run', 'dev'], {
      cwd: join(ROOT, dir),
      env: process.env,
      shell: process.platform === 'win32',
    });
    children.push(child);

    const prefix = `${color}${name.padEnd(labelWidth)}${c.reset} ${c.gray}│${c.reset} `;
    const pipe = (stream, out) => {
      let buf = '';
      stream.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) out.write(`${prefix}${line}\n`);
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);

    child.on('exit', (code) => {
      if (shuttingDown) return;
      process.stdout.write(`${prefix}${c.yellow}exited (code ${code})${c.reset}\n`);
    });
  }

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${c.gray}Stopping all apps…${c.reset}`);
    for (const child of children) child.kill('SIGINT');
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ---- Interactive arrow-key menu -------------------------------------------
function renderMenu(selected) {
  const lines = [];
  lines.push(`${c.bold}🎬 Auditorium — dev launcher${c.reset}`);
  lines.push(`${c.gray}Use ↑/↓ to choose, Enter to start, q to quit.${c.reset}\n`);
  PRESETS.forEach((p, i) => {
    const active = i === selected;
    const pointer = active ? `${c.cyan}❯${c.reset} ` : '  ';
    const text = active ? `${c.invert} ${p.label} ${c.reset}` : `  ${p.label}`;
    lines.push(`${pointer}${text}`);
  });
  lines.push(`\n${c.gray}   ${portsLine(PRESETS[selected].apps)}${c.reset}`);
  return lines.join('\n');
}

function interactiveMenu() {
  return new Promise((resolve) => {
    let selected = 0;
    const totalLines = PRESETS.length + 5;

    const draw = (first = false) => {
      if (!first) process.stdout.write(`\x1b[${totalLines}A`); // cursor up
      process.stdout.write('\x1b[0J'); // clear below
      process.stdout.write(renderMenu(selected) + '\n');
    };

    process.stdout.write('\x1b[?25l'); // hide cursor
    draw(true);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\x1b[?25h'); // show cursor
    };

    const onData = (key) => {
      if (key === '' || key === 'q') {
        cleanup();
        console.log(`${c.gray}Cancelled.${c.reset}`);
        process.exit(0);
      } else if (key === '[A' || key === 'k') {
        selected = (selected - 1 + PRESETS.length) % PRESETS.length;
        draw();
      } else if (key === '[B' || key === 'j') {
        selected = (selected + 1) % PRESETS.length;
        draw();
      } else if (key === '\r' || key === '\n') {
        cleanup();
        resolve(PRESETS[selected]);
      }
    };
    stdin.on('data', onData);
  });
}

// ---- Entry ----------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const presetArg = args.find((a) => !a.startsWith('-'));

  let preset = presetArg ? PRESETS.find((p) => p.key === presetArg) : null;
  if (presetArg && !preset) {
    console.error(`Unknown preset "${presetArg}". Options: ${PRESETS.map((p) => p.key).join(', ')}`);
    process.exit(1);
  }

  if (!preset) {
    if (!process.stdin.isTTY) {
      console.error('No TTY for the interactive menu. Pass a preset, e.g. `npm run dev all`.');
      console.error(`Presets: ${PRESETS.map((p) => p.key).join(', ')}`);
      process.exit(1);
    }
    preset = await interactiveMenu();
  }

  if (dry) {
    console.log(`Would run preset "${preset.key}": ${preset.apps.join(', ')}`);
    process.exit(0);
  }
  run(preset.apps);
}

main();
