import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { outputFiles } = await build({
  stdin: {
    contents: `export { DisplayName, VerifiedProfile } from './app/profile-identity';
      export { GratitudeProfile } from './app/gratitude-badge';`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  packages: 'external',
  write: false,
  format: 'cjs',
  platform: 'node',
});
const compiled = { exports: {} };
// Execute the compiled local components with the test's React installation.
// eslint-disable-next-line typescript/no-implied-eval
new Function('require', 'module', 'exports', outputFiles[0].text)(
  require,
  compiled,
  compiled.exports,
);
const { DisplayName, GratitudeProfile, VerifiedProfile } = compiled.exports;
const render = (Component, person) =>
  renderToStaticMarkup(
    React.createElement(Component, {
      person: { name: 'Test user', ...person },
    }),
  );

await test('gratitude only renders for awarded accounts and does not require Premium', () => {
  for (const person of [
    {},
    { gratitude: 0 },
    { premium: 1 },
    { verified: 1 },
  ]) {
    assert.doesNotMatch(render(DisplayName, person), /noct-gratitude/);
    assert.equal(render(GratitudeProfile, person), '');
  }
  const person = { gratitude: 1, premium: 0 };
  assert.match(render(DisplayName, person), /alt="С благодарностью"/);
  assert.match(
    render(GratitudeProfile, person),
    /Особый знак благодарности от команды Noctgram/,
  );
  assert.equal(render(VerifiedProfile, person), '');
});

await test('gratitude remains distinct alongside Premium and official verification', () => {
  const person = {
    gratitude: 1,
    premium: 1,
    verified: 1,
    profileTheme: 'ember',
  };
  const name = render(DisplayName, person);
  assert.equal((name.match(/class="noct-gratitude-badge"/g) || []).length, 1);
  assert.match(name, /noct-premium-badge/);
  assert.match(render(VerifiedProfile, person), /Этот аккаунт подтверждён/);
  assert.match(render(GratitudeProfile, person), /С благодарностью/);
  assert.doesNotMatch(render(GratitudeProfile, person), /помощник|официальн/i);
});
