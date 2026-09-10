import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const patterns = [
  [
    'private-key',
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  [
    'github-token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  ],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['supabase-secret', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['telegram-bot-token', /\b\d{6,12}:[A-Za-z0-9_-]{35}\b/],
];

export function secretFindings(path, contents) {
  const normalized = path.replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1);
  // Refuse sensitive tracked filenames before reading their contents.
  if (
    (basename.startsWith('.env') && basename !== '.env.example') ||
    basename === '.dev.vars' ||
    basename.startsWith('.dev.vars.') ||
    /\.(?:pem|key|p12|pfx|sqlite|db)(?:-.*)?$/i.test(basename)
  )
    return [{ rule: 'sensitive-file', line: 0 }];
  if (contents === undefined) return [];
  return patterns.flatMap(([rule, pattern]) => {
    const match = pattern.exec(contents);
    return match
      ? [{ rule, line: contents.slice(0, match.index).split('\n').length }]
      : [];
  });
}

export function scanTrackedFiles(root) {
  const files = execFileSync(
    'git',
    [
      '-c',
      `safe.directory=${resolve(root).replaceAll('\\', '/')}`,
      'ls-files',
      '-z',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
  const findings = [];
  let textFiles = 0;
  for (const path of files) {
    const sensitive = secretFindings(path);
    if (sensitive.length) {
      findings.push(...sensitive.map((finding) => ({ path, ...finding })));
      continue;
    }
    let stat;
    try {
      stat = lstatSync(join(root, path));
    } catch (error) {
      if (error.code === 'ENOENT') continue; // A tracked file deleted in this checkout.
      throw error;
    }
    // Do not follow a tracked symlink outside the repository.
    if (!stat.isFile()) continue;
    if (stat.size > 8 * 1024 * 1024) {
      findings.push({ path, rule: 'file-too-large-for-scan', line: 0 });
      continue;
    }
    const data = readFileSync(join(root, path));
    if (data.includes(0)) continue;
    textFiles++;
    findings.push(
      ...secretFindings(path, data.toString('utf8')).map((finding) => ({
        path,
        ...finding,
      })),
    );
  }
  return { findings, textFiles };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { findings, textFiles } = scanTrackedFiles(process.cwd());
    for (const finding of findings) {
      // JSON quoting prevents control characters in filenames from changing logs.
      console.error(
        `${JSON.stringify(finding.path)}:${finding.line} ${finding.rule} [REDACTED]`,
      );
    }
    console.log(
      `Secret check: ${textFiles} tracked text files, ${findings.length} findings. Values are never printed.`,
    );
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    console.error(
      'Secret check failed; verify Git and repository access. No file contents were printed.',
    );
    process.exitCode = 1;
  }
}
