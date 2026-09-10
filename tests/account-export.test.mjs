import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../lib/account-export.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { accountExport } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

void test('streams every page as valid UTF-8 JSON, including empty sections and escaped content', async () => {
  const calls = [];
  const rows = Array.from({ length: 237 }, (_, i) => ({
    id: String(i + 1).padStart(5, '0'),
    text: 'Сообщение 🌙 "\\\n' + i,
  }));
  const response = accountExport({ profile: { name: 'Тест' } }, [
    {
      name: 'messages',
      async page(after) {
        calls.push(after);
        const page = rows.filter((row) => row.id > after).slice(0, 100);
        return {
          rows: page,
          next: page.length === 100 ? page.at(-1).id : null,
        };
      },
    },
    {
      name: 'empty',
      async page() {
        return { rows: [], next: null };
      },
    },
  ]);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.deepEqual(await response.json(), {
    profile: { name: 'Тест' },
    messages: rows,
    empty: [],
  });
  assert.deepEqual(calls, ['', '00100', '00200']);
});

void test('a slow or cancelled consumer cannot cause an unbounded database read', async () => {
  let queries = 0;
  const response = accountExport({ format: 'JSON' }, [
    {
      name: 'messages',
      async page(after) {
        queries++;
        const id = String(Number(after || 0) + 1).padStart(5, '0');
        return { rows: [{ id, text: 'x'.repeat(5000) }], next: id };
      },
    },
  ]);
  const reader = response.body.getReader();
  await reader.read();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queries, 0);
  await reader.read();
  await reader.read();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(queries >= 1 && queries <= 2);
  await reader.cancel();
  const stopped = queries;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queries, stopped);
});

void test('a broken cursor terminates the download rather than querying forever', async () => {
  let queries = 0;
  const response = accountExport({}, [
    {
      name: 'messages',
      async page() {
        queries++;
        return { rows: [{ id: '001' }], next: '001' };
      },
    },
  ]);
  await assert.rejects(response.json(), /Invalid export cursor/);
  assert.equal(queries, 2);
});
