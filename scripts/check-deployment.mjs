import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const secretKeys = new Set([
  'NOCT_JOBS_SECRET',
  'NOCT_VAPID_PRIVATE_KEY',
  'MUSIC_TOKEN_KEY',
  'SOUNDCLOUD_CLIENT_SECRET',
  'NOCT_CF_TURN_API_TOKEN',
  'NOCT_TURN_SECRET',
  'NOCT_BOT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
]);
const present = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const httpsOrigin = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

// Accept Wrangler's secret list or a name-only array; never consume secret values.
export function parseSecretNames(input) {
  if (!Array.isArray(input))
    throw new Error('Expected a JSON array of secret names.');
  const names = input.map((item) =>
    typeof item === 'string' ? item : item?.name,
  );
  if (
    names.some(
      (name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name),
    )
  ) {
    throw new Error('Invalid secret name inventory.');
  }
  return new Set(names);
}

export function validateDeployment(
  config,
  { target = 'public', secretNames = new Set() } = {},
) {
  const errors = [];
  const requireSetting = (name) => {
    if (!present(vars[name]) && !secretNames.has(name))
      errors.push(`${name} is required.`);
  };
  if (!object(config)) return ['Configuration must be a JSON object.'];
  if (!['public', 'access-preview'].includes(target))
    return ['Unknown deployment target.'];
  const vars = object(config.vars) ? config.vars : {};
  const hasSetting = (name) => present(vars[name]) || secretNames.has(name);
  if (config.env)
    errors.push(
      'Pass the resolved configuration for one environment; nested env overrides are not accepted.',
    );
  if (!present(config.name)) errors.push('Worker name is required.');
  const databases = Array.isArray(config.d1_databases)
    ? config.d1_databases
    : [];
  const buckets = Array.isArray(config.r2_buckets) ? config.r2_buckets : [];
  const db = databases.filter((entry) => entry?.binding === 'DB');
  const files = buckets.filter((entry) => entry?.binding === 'FILES');
  if (
    db.length !== 1 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      db[0]?.database_id || '',
    ) ||
    (db[0]?.database_id || '').startsWith('00000000-0000-')
  )
    errors.push(
      'Exactly one DB binding with a non-placeholder D1 database_id is required.',
    );
  if (
    files.length !== 1 ||
    !present(files[0]?.bucket_name) ||
    files[0]?.bucket_name === 'site-creator-r2'
  ) {
    errors.push(
      'Exactly one FILES binding with a real R2 bucket_name is required.',
    );
  }
  for (const name of secretKeys) {
    if (present(vars[name]))
      errors.push(`${name} must be stored as a Worker secret, not in vars.`);
  }
  // Auth mode must be visible in the resolved config, not a hidden secret override.
  if (secretNames.has('NOCT_AUTH_MODE'))
    errors.push(
      'NOCT_AUTH_MODE must be an explicit config variable, not a secret.',
    );
  if (target === 'public') {
    if (vars.NOCT_DEPLOYMENT_TARGET !== 'standalone')
      errors.push(
        'Public deployment requires NOCT_DEPLOYMENT_TARGET=standalone.',
      );
    if (vars.NOCT_AUTH_MODE !== 'email') {
      errors.push(
        'Public standalone deployment requires NOCT_AUTH_MODE=email; missing, unknown, hybrid and access modes are refused.',
      );
    }
    if (!httpsOrigin(vars.SUPABASE_URL))
      errors.push('SUPABASE_URL must be an explicit public HTTPS origin.');
    requireSetting('SUPABASE_PUBLISHABLE_KEY');
  } else {
    if (vars.NOCT_DEPLOYMENT_TARGET === 'standalone')
      errors.push(
        'Access preview cannot use the standalone deployment target.',
      );
    if (vars.NOCT_AUTH_MODE !== 'access')
      errors.push('Private preview requires NOCT_AUTH_MODE=access.');
    if (
      !/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(
        vars.NOCT_ACCESS_TEAM_DOMAIN || '',
      )
    ) {
      errors.push(
        'NOCT_ACCESS_TEAM_DOMAIN must be an exact HTTPS Cloudflare Access team domain.',
      );
    }
    if (!/^[a-f0-9]{64}$/.test(vars.NOCT_ACCESS_AUD || ''))
      errors.push('NOCT_ACCESS_AUD must be a valid Access audience.');
    let members;
    try {
      members = JSON.parse(vars.NOCT_ACCESS_USERS);
    } catch {
      members = null;
    }
    const entries = object(members) ? Object.entries(members) : [];
    const ids = new Set();
    if (
      entries.length < 1 ||
      entries.length > 3 ||
      entries.some(([email, member]) => {
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email !== email.toLowerCase() ||
          !object(member) ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(member.userId || '') ||
          ids.has(member.userId) ||
          (member.name !== undefined &&
            (typeof member.name !== 'string' || member.name.length > 100))
        )
          return true;
        ids.add(member.userId);
        return false;
      })
    )
      errors.push(
        'NOCT_ACCESS_USERS must map one to three lowercase emails to distinct valid user IDs.',
      );
  }
  if (
    vars.NOCT_AUTH_ALLOW_LOCAL_PROVIDER === '1' ||
    secretNames.has('NOCT_AUTH_ALLOW_LOCAL_PROVIDER')
  ) {
    errors.push(
      'Local test email providers must be disabled on standalone deployments.',
    );
  }
  // Test economy is intentionally supported; this check does not change those flags.
  if (Array.isArray(config.triggers?.crons) && config.triggers.crons.length)
    requireSetting('NOCT_JOBS_SECRET');
  if (
    [
      'NOCT_VAPID_PUBLIC_KEY',
      'NOCT_VAPID_PRIVATE_KEY',
      'NOCT_VAPID_SUBJECT',
    ].some(hasSetting)
  ) {
    for (const name of [
      'NOCT_VAPID_PUBLIC_KEY',
      'NOCT_VAPID_PRIVATE_KEY',
      'NOCT_VAPID_SUBJECT',
    ])
      requireSetting(name);
    requireSetting('NOCT_JOBS_SECRET');
  }
  for (const provider of ['SOUNDCLOUD', 'SPOTIFY']) {
    if (
      [
        `${provider}_CLIENT_ID`,
        `${provider}_REDIRECT_URI`,
        `${provider}_CLIENT_SECRET`,
      ].some(hasSetting)
    ) {
      requireSetting(`${provider}_CLIENT_ID`);
      requireSetting(`${provider}_REDIRECT_URI`);
      requireSetting('MUSIC_TOKEN_KEY');
      if (provider === 'SOUNDCLOUD') requireSetting('SOUNDCLOUD_CLIENT_SECRET');
      try {
        const redirect = new URL(vars[`${provider}_REDIRECT_URI`]);
        if (
          !httpsOrigin(redirect.origin) ||
          redirect.username ||
          redirect.password ||
          redirect.search ||
          redirect.hash ||
          redirect.pathname !==
            `/api/music/services/${provider.toLowerCase()}/callback`
        )
          throw new Error();
      } catch {
        errors.push(
          `${provider}_REDIRECT_URI must be an explicit HTTPS callback URL for this provider.`,
        );
      }
    }
  }
  const turn = vars.NOCT_TURN_PROVIDER;
  if (turn && !['none', 'cloudflare', 'coturn'].includes(turn))
    errors.push('Unknown NOCT_TURN_PROVIDER.');
  if (turn === 'cloudflare') {
    requireSetting('NOCT_CF_TURN_KEY_ID');
    requireSetting('NOCT_CF_TURN_API_TOKEN');
  }
  if (turn === 'coturn' || (!turn && hasSetting('NOCT_TURN_SECRET'))) {
    requireSetting('NOCT_TURN_SECRET');
    if (
      !present(vars.NOCT_TURN_URLS) ||
      vars.NOCT_TURN_URLS.split(',').some(
        (url) => !/^turns?:[^\s]+$/.test(url.trim()),
      )
    ) {
      errors.push('NOCT_TURN_URLS must contain explicit TURN URLs for coturn.');
    }
  }
  return errors;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (
        !['--config', '--target', '--secret-names'].includes(args[index]) ||
        !args[index + 1] ||
        options[args[index]]
      ) {
        throw new Error();
      }
      options[args[index]] = args[index + 1];
    }
    if (!options['--config']) throw new Error();
    const config = JSON.parse(
      readFileSync(options['--config'], 'utf8').replace(/^\uFEFF/, ''),
    );
    const secretNames = options['--secret-names']
      ? parseSecretNames(
          JSON.parse(
            readFileSync(options['--secret-names'], 'utf8').replace(
              /^\uFEFF/,
              '',
            ),
          ),
        )
      : new Set();
    const errors = validateDeployment(config, {
      target: options['--target'] || 'public',
      secretNames,
    });
    for (const error of errors) console.error(`FAIL: ${error}`);
    if (!errors.length)
      console.log(
        'Standalone configuration check passed. Remote bindings, secrets, gateway coverage and delivery still require operational verification.',
      );
    process.exitCode = errors.length ? 1 : 0;
  } catch {
    console.error(
      'Cannot validate configuration. Usage: node scripts/check-deployment.mjs --config <resolved.json> [--target public|access-preview] [--secret-names <names.json>]. Values are never printed.',
    );
    process.exitCode = 1;
  }
}
