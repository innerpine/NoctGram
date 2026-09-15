import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--list') || args.length > 1) {
  console.error('Usage: node scripts/run-tests.mjs [--list]');
  process.exit(1);
}
// Explicit discovery avoids shell glob differences between Windows and Linux.
// Integration scripts require a separately prepared isolated Worker and are excluded.
const files = ['tests', 'noct-gifts']
  .flatMap((directory) =>
    readdirSync(join(root, directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
      .map((entry) => join(directory, entry.name)),
  )
  .sort((a, b) => a.localeCompare(b));
if (!files.length) {
  console.error('No isolated *.test.mjs files found.');
  process.exit(1);
}
if (args.includes('--list')) {
  console.log(files.join('\n'));
} else {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...files],
    { cwd: root, stdio: 'inherit', shell: false },
  );
  if (result.error || result.signal) {
    console.error('The isolated test runner could not complete.');
  }
  process.exitCode = result.status ?? 1;
}
