import { ApiError } from './api-error';

export const PREVIEW_STORAGE_BYTES = 3 * 1024 * 1024 * 1024;
export const PREVIEW_WRITES_PER_MONTH = 10_000;
export const PREVIEW_READS_PER_MONTH = 200_000;
const permanent = Number.MAX_SAFE_INTEGER;

async function claim(
  db: D1Database,
  key: string,
  amount: number,
  maximum: number,
  expiresAt: number,
) {
  const accepted = await db
    .prepare(`INSERT INTO auth_limits(key,count,expiresAt)
    SELECT ?,?,? WHERE ?<=?
    ON CONFLICT(key) DO UPDATE SET count=count+excluded.count
    WHERE count+excluded.count<=? RETURNING key`)
    .bind(key, amount, expiresAt, amount, maximum, maximum)
    .first();
  if (!accepted)
    throw new ApiError(
      429,
      'Достигнут лимит хранилища тестовой версии. Повторите позже или обратитесь к владельцу.',
      'PREVIEW_STORAGE_LIMIT',
    );
}

function bodyBytes(value: unknown) {
  if (typeof value === 'string')
    return new TextEncoder().encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  if (value === null) return 0;
  // A stream without a known size must not bypass the cumulative upload budget.
  throw new ApiError(
    400,
    'Для тестового хранилища требуется файл с известным размером.',
  );
}

export function previewBucket(raw: R2Bucket, db: D1Database): R2Bucket {
  const monthly = async (kind: 'read' | 'write') => {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    await claim(
      db,
      `preview:r2:${kind}:${month}`,
      1,
      kind === 'read' ? PREVIEW_READS_PER_MONTH : PREVIEW_WRITES_PER_MONTH,
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1),
    );
  };
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'get' || prop === 'head')
        return async (...args: unknown[]) => {
          await monthly('read');
          return Reflect.apply(target[prop], target, args);
        };
      if (prop === 'list')
        return async (...args: unknown[]) => {
          await monthly('write');
          return Reflect.apply(target.list.bind(target), target, args);
        };
      if (prop === 'put')
        return async (...args: unknown[]) => {
          const bytes = bodyBytes(args[1]);
          await monthly('write');
          await claim(
            db,
            'preview:r2:uploaded-bytes',
            bytes,
            PREVIEW_STORAGE_BYTES,
            permanent,
          );
          // Failed or replaced uploads keep their reservation. This intentionally
          // overcounts, keeping abandoned objects and retries inside the test budget.
          return Reflect.apply(target.put.bind(target), target, args);
        };
      if (prop === 'delete') return target.delete.bind(target);
      throw new Error(
        'This R2 operation is not enabled in the private preview',
      );
    },
  });
}
