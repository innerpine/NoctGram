import { ApiError } from './api-error';

export const REPLY_QUOTE_LIMIT = 1024;
// A quote is a fragment of the replied message's stored text. The write gate
// checks that it still occurs in that text with instr().
export function replyQuoteValue(quote: unknown, replyTo: unknown) {
  if (quote === undefined || quote === null || quote === '') return '';
  if (
    typeof quote !== 'string' ||
    !quote.trim() ||
    quote.length > REPLY_QUOTE_LIMIT
  )
    throw new ApiError(400, 'Цитата должна быть фрагментом до 1024 символов');
  if (typeof replyTo !== 'string' || !replyTo)
    throw new ApiError(400, 'Цитата относится только к ответу на сообщение');
  return quote;
}
