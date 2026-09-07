import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Exercise the real client uploader with framework/proxy responses in memory.
const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const moduleUrl = (js) =>
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
const helper = moduleUrl(compile('lib/http-response.ts'));
const client = compile('lib/client.ts').replace(
  /from ['"]\.\/http-response['"]/,
  'from ' + JSON.stringify(helper),
);
const { upload, request } = await import(moduleUrl(client));
const originalFetch = globalThis.fetch;
const file = new File(['fixture'], 'avatar.mp4', { type: 'video/mp4' });
try {
  for (const [body, status, expected] of [
    ['Payload Too Large', 413, /превышен допустимый размер запроса/],
    ['<html>Bad Gateway</html>', 502, /Сервер временно недоступен/],
    ['', 401, /Войдите в Noctgram/],
    ['<html>Wrong route</html>', 200, /некорректный ответ/],
    ['null', 200, /некорректный ответ/],
  ]) {
    globalThis.fetch = async () => new Response(body, { status });
    await assert.rejects(() => upload(file), expected);
    await assert.rejects(() => request('?action=feed'), expected);
  }
  globalThis.fetch = async () =>
    Response.json({ error: 'Аватарка — до 5 МБ.' }, { status: 413 });
  await assert.rejects(() => upload(file), /Аватарка — до 5 МБ/);
  const media = {
    id: 'test',
    name: 'avatar.mp4',
    type: 'video/mp4',
    url: '/api/media/test',
  };
  globalThis.fetch = async (_url, options) => {
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('file'), file);
    return Response.json(media);
  };
  assert.deepEqual(await upload(file), media);
  globalThis.fetch = async () => Response.json([]);
  assert.deepEqual(await request('?action=feed'), []);
  console.log(
    'PASS upload errors: plain 413, HTML 502, expired session, malformed success, valid JSON errors/media and feed arrays.',
  );
} finally {
  globalThis.fetch = originalFetch;
}
