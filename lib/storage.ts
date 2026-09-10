import { env } from 'cloudflare:workers';
import { previewBucket } from './preview-storage';
export function db() {
  return (env as unknown as { DB: D1Database }).DB;
}
export function bucket(actor?: string) {
  const bindings = env as unknown as {
    FILES: R2Bucket;
    NOCT_AUTH_MODE?: string;
  };
  return bindings.NOCT_AUTH_MODE === 'access'
    ? previewBucket(bindings.FILES, db(), actor)
    : bindings.FILES;
}
