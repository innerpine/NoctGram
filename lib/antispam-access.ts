// Internal aliases only. Used for ordinary groups; encrypted rooms are excluded by callers.
export function groupSenderVisible(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw new Error('Invalid alias');
  return `NOT EXISTS(SELECT 1 FROM account_restrictions spamblock WHERE spamblock.userId=${alias}.sender
    AND spamblock.mode='blocked' AND (spamblock.expiresAt IS NULL OR spamblock.expiresAt>strftime('%s','now')*1000))`;
}
