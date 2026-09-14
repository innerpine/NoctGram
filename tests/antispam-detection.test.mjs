import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const output = await build({
  entryPoints: ['lib/antispam-detection.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { detectSpamDomain, spamFingerprint } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(output.outputFiles[0].text).toString('base64')
);
const domain = 'unixgram.com',
  encoded = Buffer.from(domain).toString('base64');
const fullwidth = (text) =>
  [...text].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
test('blocks direct and obfuscated domain forms without executing supplied code', () => {
  for (const input of [
    domain,
    'https://UNIXGRAM.COM/path',
    'u n i x g r a m [.] c o m',
    'unixgram dot com',
    'unixgram точка com',
    'unіxgrаm.com',
    'un\u200bixgram.com',
    fullwidth(domain),
    '%75nixgram.com',
    '100% cool %75nixgram.com',
    'print("' + encoded + '") #decode this is base64',
    encoded,
    Buffer.from(encoded).toString('base64'),
    encoded.slice(0, 8) + '\u200b' + encoded.slice(8),
    fullwidth(encoded),
    'abcdefgh '.repeat(49) + encoded,
    'aGVsbG8= '.repeat(300) + encoded,
    Buffer.from('https://unixgram.com/?>').toString('base64url'),
  ]) {
    assert.equal(detectSpamDomain(input, [domain]), domain, input);
  }
});
test('allows unrelated text, harmless Base64, code and similar unlisted domains', () => {
  for (const input of [
    'Привет, как дела?',
    'unix grammar',
    'notunixgram.com',
    'unixgram.community',
    'aGVsbG8=',
    'print("Hello")',
    '%zz %E0%A4%A',
    'invalid===',
    'dW5peGdyYW0uY29tZ',
    'github.com',
  ])
    assert.equal(detectSpamDomain(input, [domain]), null, input);
  assert.equal(detectSpamDomain('unixgram', [domain]), null);
  assert.equal(detectSpamDomain('unixgram', [domain], true), domain);
  assert.equal(detectSpamDomain('u_n_i_x_g_r_a_m_com', [domain], true), domain);
  assert.equal(detectSpamDomain(domain, []), null);
});
test('configured hyphenated labels do not produce exponential regex backtracking', () => {
  const start = performance.now();
  assert.equal(
    detectSpamDomain('a' + '-'.repeat(10000) + 'c.com', ['a-------b.com']),
    null,
  );
  assert.equal(
    detectSpamDomain('my-project.com', ['my-project.com']),
    'my-project.com',
  );
  assert.ok(performance.now() - start < 1500);
});
test('long content is bounded, and fingerprints preserve meaningful distinctions', () => {
  assert.equal(
    detectSpamDomain('\ufdfa'.repeat(2000) + ' ' + domain, [domain]),
    domain,
  );
  assert.equal(
    detectSpamDomain(domain + ' ' + '\ufdfa'.repeat(6000), [domain]),
    domain,
  );
  assert.equal(detectSpamDomain('!'.repeat(31000) + domain, [domain]), domain);
  assert.equal(detectSpamDomain('!'.repeat(50000) + domain, [domain]), null);
  assert.equal(
    spamFingerprint('ПРИВЕТ\u200b   Мир!'),
    spamFingerprint('привет мир'),
  );
  assert.notEqual(
    spamFingerprint('Встреча сегодня'),
    spamFingerprint('Встреча завтра'),
  );
});
