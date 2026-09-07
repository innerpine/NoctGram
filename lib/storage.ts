import { env } from 'cloudflare:workers';
export function db() {
  return (env as unknown as { DB: D1Database }).DB;
}
export function bucket() {
  return (env as unknown as { FILES: R2Bucket }).FILES;
}
