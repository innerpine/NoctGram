import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { localTestAccounts } from './scripts/local-test-accounts';
import { readFileSync } from 'node:fs';
import {
  parseSecretNames,
  validateDeployment,
} from './scripts/check-deployment.mjs';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  const previewConfigPath = process.env.NOCT_PREVIEW_CONFIG;
  const publicConfigPath = process.env.NOCT_PUBLIC_CONFIG;
  if (previewConfigPath && publicConfigPath)
    throw new Error(
      'Choose either the private preview or the public deployment',
    );
  const publicConfig = publicConfigPath
    ? JSON.parse(readFileSync(publicConfigPath, 'utf8').replace(/^\uFEFF/, ''))
    : null;
  if (publicConfig) {
    const secretNames = process.env.NOCT_PUBLIC_SECRET_NAMES
      ? parseSecretNames(
          JSON.parse(
            readFileSync(process.env.NOCT_PUBLIC_SECRET_NAMES, 'utf8').replace(
              /^\uFEFF/,
              '',
            ),
          ),
        )
      : new Set<string>();
    const errors = validateDeployment(publicConfig, {
      target: 'public',
      secretNames,
    });
    if (errors.length) throw new Error(errors.join('\n'));
  }
  const previewConfig = previewConfigPath
    ? JSON.parse(readFileSync(previewConfigPath, 'utf8'))
    : null;
  if (
    previewConfig &&
    (previewConfig.vars?.NOCT_AUTH_MODE !== 'access' ||
      !previewConfig.d1_databases?.[0]?.database_id ||
      !previewConfig.r2_buckets?.[0]?.bucket_name)
  )
    throw new Error(
      'Private preview requires Access authentication, D1 and R2 configuration',
    );
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    // Lightning CSS merges independent translate/scale with transform across
    // popup rules. That doubles Tailwind's centering in the production player
    // and changes the properties used by our open/close transitions.
    build: { cssMinify: 'esbuild' as const },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...localTestAccounts(sites()),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: publicConfig
          ? {
              ...publicConfig,
              main: './worker/public.ts',
              compatibility_flags: ['nodejs_compat'],
              assets: { binding: 'ASSETS', run_worker_first: true },
            }
          : previewConfig
            ? {
                ...previewConfig,
                main: './worker/shared-preview.ts',
                compatibility_flags: ['nodejs_compat'],
                assets: { binding: 'ASSETS', run_worker_first: true },
              }
            : localBindingConfig,
      }),
    ],
  };
});
