import fs from 'node:fs';
const file = '.env';
let text = fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8')
  : fs.readFileSync('.env.example', 'utf8');
const has = (name) => new RegExp('^' + name + '=.+$', 'm').test(text);
const set = (name, value) => {
  const pattern = new RegExp('^' + name + '=.*$', 'm');
  text = pattern.test(text)
    ? text.replace(pattern, name + '=' + value)
    : text + '\n' + name + '=' + value + '\n';
};
if (!has('NOCT_VAPID_PUBLIC_KEY') && !has('NOCT_VAPID_PRIVATE_KEY')) {
  const key = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  set(
    'NOCT_VAPID_PUBLIC_KEY',
    Buffer.from(await crypto.subtle.exportKey('raw', key.publicKey)).toString(
      'base64url',
    ),
  );
  set(
    'NOCT_VAPID_PRIVATE_KEY',
    (await crypto.subtle.exportKey('jwk', key.privateKey)).d,
  );
} else if (!has('NOCT_VAPID_PUBLIC_KEY') || !has('NOCT_VAPID_PRIVATE_KEY'))
  throw Error(
    'Incomplete VAPID pair. Restore both original keys; do not rotate an existing key automatically.',
  );
if (!has('NOCT_VAPID_SUBJECT'))
  set('NOCT_VAPID_SUBJECT', 'https://github.com/innerpine/NoctGram');
if (!has('NOCT_JOBS_SECRET'))
  set(
    'NOCT_JOBS_SECRET',
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      'base64url',
    ),
  );
fs.writeFileSync(file, text);
console.log(
  'Realtime configuration prepared in ignored .env. Existing keys preserved; no secrets printed.',
);
