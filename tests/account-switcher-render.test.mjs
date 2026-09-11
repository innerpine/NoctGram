import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  entryPoints: ['app/account-switcher.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'switcher-surroundings',
      setup(builder) {
        builder.onResolve(
          { filter: /^(react(?:\/.*)?|lucide-react)$/ },
          ({ path }) => ({
            path: pathToFileURL(require.resolve(path)).href,
            external: true,
          }),
        );
        builder.onResolve(
          {
            filter:
              /^(\.\/post-card|@\/components\/ui\/dialog|@\/lib\/auth-client)$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
      export const Avatar=()=>null;
      export const Dialog=()=>null, DialogContent=()=>null, DialogTitle=()=>null, DialogDescription=()=>null;
      export const authRequest=()=>{throw Error('Network must not run during SSR')};
    `,
        }));
      },
    },
  ],
});
const randomUUID = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
try {
  // Cloudflare disallows random values during module initialization. Server
  // loading and rendering must leave the browser synchronization ID untouched.
  crypto.randomUUID = () => {
    throw Error('Random values outside a request');
  };
  const { AccountSwitcher } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(outputFiles[0].text).toString('base64')
  );
  assert.equal(
    renderToString(createElement(AccountSwitcher, { userId: 'synthetic' })),
    '',
  );
} finally {
  if (randomUUID) Object.defineProperty(crypto, 'randomUUID', randomUUID);
  else delete crypto.randomUUID;
}
console.log(
  'Account switcher loads and renders without startup randomness or network.',
);
