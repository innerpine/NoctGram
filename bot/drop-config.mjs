export function dropConfig(env = process.env) {
  const token = env.NOCT_GIFTS_BOT_TOKEN || '';
  if (!/^\d+:[a-zA-Z0-9_-]{30,}$/.test(token))
    throw Error('Set NOCT_GIFTS_BOT_TOKEN on the server.');
  let url;
  try {
    url = new URL(env.NOCT_GIFTS_APP_URL);
  } catch {
    throw Error('Set NOCT_GIFTS_APP_URL to the public HTTPS mini-app URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw Error('NOCT_GIFTS_APP_URL must use HTTPS without credentials.');
  return { token, url: url.href };
}
