import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['app/app-link.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
});
const { AppLink } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
function event(extra = {}) {
  return {
    button: 0,
    defaultPrevented: false,
    currentTarget: { target: '', hasAttribute: () => false },
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra,
  };
}

await test('ordinary and keyboard-activated links navigate without reloading the document', () => {
  let navigations = 0;
  const link = AppLink({
    href: '/music?tab=library',
    children: 'Музыка',
    onNavigate: () => navigations++,
  });
  assert.equal(link.type, 'a');
  assert.equal(link.props.href, '/music?tab=library');
  assert.equal(link.props.children, 'Музыка');
  for (const detail of [1, 0]) {
    const click = event({ detail });
    link.props.onClick(click);
    assert.equal(click.defaultPrevented, true);
  }
  assert.equal(navigations, 2);
});

await test('new-tab, modified, download and cancelled clicks retain native browser behavior', () => {
  let navigations = 0;
  const link = AppLink({
    href: '/?profile=invoker',
    onNavigate: () => navigations++,
  });
  const cases = [
    { button: 1 },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { currentTarget: { target: '_blank', hasAttribute: () => false } },
    {
      currentTarget: {
        target: '',
        hasAttribute: (name) => name === 'download',
      },
    },
  ];
  for (const extra of cases) {
    const click = event(extra);
    link.props.onClick(click);
    assert.equal(click.defaultPrevented, false);
  }
  const cancelled = event();
  AppLink({
    href: '/',
    onNavigate: () => navigations++,
    onClick: (e) => e.preventDefault(),
  }).props.onClick(cancelled);
  assert.equal(navigations, 0);
});
