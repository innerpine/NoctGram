import { db } from './storage';
import { ApiError } from './api-error';
import { assertWritable } from './account-access';

export async function isAdministrator(me: string) {
  return !!(await db()
    .prepare('SELECT userId FROM administrators WHERE userId=?')
    .bind(me)
    .first());
}
export async function requireAdministrator(me: string) {
  await assertWritable(me);
  if (!(await isAdministrator(me)))
    throw new ApiError(403, 'Доступно только администратору.');
}
