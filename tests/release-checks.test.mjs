import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  validateDeployment,
  parseSecretNames,
} from '../scripts/check-deployment.mjs';
import { scanTrackedFiles, secretFindings } from '../scripts/check-secrets.mjs';

const publicConfig = () => ({
  name: 'noctgram-release-fixture',
  d1_databases: [
    { binding: 'DB', database_id: '12345678-abcd-1234-5678-123456789abc' },
  ],
  r2_buckets: [{ binding: 'FILES', bucket_name: 'noctgram-fixture-files' }],
  vars: {
    NOCT_AUTH_MODE: 'email',
    NOCT_DEPLOYMENT_TARGET: 'standalone',
    SUPABASE_URL: 'https://auth.example.invalid',
    SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
  },
});

void test('standalone public refuses missing, unknown, hybrid and access auth', () => {
  for (const mode of [undefined, '', 'hybrid', 'access', 'EMAIL', 'typo']) {
    const config = publicConfig();
    config.vars.NOCT_AUTH_MODE = mode;
    assert.ok(
      validateDeployment(config).some((error) =>
        error.includes('requires NOCT_AUTH_MODE=email'),
      ),
    );
  }
  assert.deepEqual(validateDeployment(publicConfig()), []);
});

void test('bindings, local provider, env overrides and embedded secrets fail closed', () => {
  for (const mutate of [
    (config) => {
      delete config.vars.NOCT_DEPLOYMENT_TARGET;
    },
    (config) => {
      config.d1_databases[0].database_id =
        '00000000-0000-4000-8000-000000000000';
    },
    (config) => {
      config.d1_databases[0].binding = 'WRONG';
    },
    (config) => {
      config.r2_buckets = [];
    },
    (config) => {
      config.r2_buckets.push(config.r2_buckets[0]);
    },
    (config) => {
      config.vars.SUPABASE_URL = 'http://127.0.0.1:9191';
    },
    (config) => {
      config.vars.SUPABASE_URL = 'https://user:pass@auth.example.invalid';
    },
    (config) => {
      config.vars.NOCT_AUTH_ALLOW_LOCAL_PROVIDER = '1';
    },
    (config) => {
      config.vars.NOCT_JOBS_SECRET = 'synthetic-only';
    },
    (config) => {
      config.env = { production: {} };
    },
  ]) {
    const config = publicConfig();
    mutate(config);
    assert.ok(validateDeployment(config).length > 0);
  }
});

void test('secret inventory checks required keys and never allows hidden auth override', () => {
  const config = publicConfig();
  delete config.vars.SUPABASE_PUBLISHABLE_KEY;
  assert.ok(
    validateDeployment(config).some((error) =>
      error.includes('SUPABASE_PUBLISHABLE_KEY'),
    ),
  );
  assert.deepEqual(
    validateDeployment(config, {
      secretNames: parseSecretNames([
        { name: 'SUPABASE_PUBLISHABLE_KEY', type: 'secret_text' },
      ]),
    }),
    [],
  );
  assert.ok(
    validateDeployment(config, {
      secretNames: parseSecretNames([
        'SUPABASE_PUBLISHABLE_KEY',
        'NOCT_AUTH_MODE',
      ]),
    }).some((error) => error.includes('explicit config variable')),
  );
  assert.throws(() =>
    parseSecretNames({ SUPABASE_PUBLISHABLE_KEY: 'not-a-name-list' }),
  );
});

void test('Access preview validates its explicit member map and needs jobs secret for cron', () => {
  const config = publicConfig();
  config.vars = {
    NOCT_AUTH_MODE: 'access',
    NOCT_ACCESS_TEAM_DOMAIN: 'https://fixture.cloudflareaccess.com',
    NOCT_ACCESS_AUD: 'a'.repeat(64),
    NOCT_ACCESS_USERS: JSON.stringify({
      'owner@example.invalid': { userId: 'owner' },
    }),
  };
  const options = { target: 'access-preview' };
  assert.deepEqual(validateDeployment(config, options), []);
  config.triggers = { crons: ['* * * * *'] };
  assert.ok(
    validateDeployment(config, options).some((error) =>
      error.includes('NOCT_JOBS_SECRET'),
    ),
  );
  options.secretNames = new Set(['NOCT_JOBS_SECRET']);
  assert.deepEqual(validateDeployment(config, options), []);
  config.vars.NOCT_ACCESS_USERS = JSON.stringify({
    'owner@example.invalid': { userId: 'owner' },
    'friend@example.invalid': { userId: 'owner' },
  });
  assert.ok(
    validateDeployment(config, options).some((error) =>
      error.includes('NOCT_ACCESS_USERS'),
    ),
  );
});

void test('enabled integrations require their secret dependencies', () => {
  const config = publicConfig();
  config.vars.SOUNDCLOUD_CLIENT_ID = 'fixture-client';
  config.vars.SOUNDCLOUD_REDIRECT_URI =
    'https://app.example.invalid/api/music/services/soundcloud/callback';
  config.vars.NOCT_TURN_PROVIDER = 'cloudflare';
  config.vars.NOCT_CF_TURN_KEY_ID = 'fixture-turn-key';
  assert.equal(validateDeployment(config).length, 3);
  assert.deepEqual(
    validateDeployment(config, {
      secretNames: new Set([
        'MUSIC_TOKEN_KEY',
        'SOUNDCLOUD_CLIENT_SECRET',
        'NOCT_CF_TURN_API_TOKEN',
      ]),
    }),
    [],
  );
});

void test('secret rules report locations without including matched values', () => {
  const synthetic = 'gh' + 'p_' + 'a'.repeat(36);
  assert.deepEqual(secretFindings('lib/example.ts', 'safe\n' + synthetic), [
    { rule: 'github-token', line: 2 },
  ]);
  assert.deepEqual(secretFindings('nested/.env.production'), [
    { rule: 'sensitive-file', line: 0 },
  ]);
  assert.deepEqual(secretFindings('.env.example', 'NOCT_JOBS_SECRET='), []);
  assert.ok(
    !JSON.stringify(secretFindings('lib/example.ts', synthetic)).includes(
      synthetic,
    ),
  );
});

void test('tracked-file scan ignores untracked .env, flags tracked .env without reading contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'noctgram-secret-fixture-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, '.env'), 'UNTRACKED_VALUE=synthetic-only');
    writeFileSync(join(root, 'safe.txt'), 'safe fixture');
    execFileSync('git', ['-C', root, 'add', 'safe.txt']);
    assert.deepEqual(scanTrackedFiles(root), { textFiles: 1, findings: [] });
    execFileSync('git', ['-C', root, 'add', '.env']);
    assert.deepEqual(scanTrackedFiles(root), {
      textFiles: 1,
      findings: [{ path: '.env', rule: 'sensitive-file', line: 0 }],
    });
    const synthetic = 'gh' + 'p_' + 'b'.repeat(36);
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'bad.txt'), synthetic);
    execFileSync('git', ['-C', root, 'add', 'lib/bad.txt']);
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scripts/check-secrets.mjs', import.meta.url))],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /REDACTED/);
    assert.ok(
      !run.stdout.includes(synthetic) && !run.stderr.includes(synthetic),
    );
    const config = publicConfig();
    config.vars.NOCT_AUTH_MODE = synthetic;
    writeFileSync(join(root, 'deployment.json'), JSON.stringify(config));
    const invalidDeployment = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../scripts/check-deployment.mjs', import.meta.url),
        ),
        '--config',
        join(root, 'deployment.json'),
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(invalidDeployment.status, 1);
    assert.match(invalidDeployment.stderr, /requires NOCT_AUTH_MODE=email/);
    assert.ok(
      !invalidDeployment.stdout.includes(synthetic) &&
        !invalidDeployment.stderr.includes(synthetic),
    );
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('noctgram-secret-fixture-'));
    rmSync(root, { recursive: true, force: true });
  }
});
