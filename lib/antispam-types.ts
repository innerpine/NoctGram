export type SpamKind = 'post' | 'comment' | 'group';
export type SpamPayload = {
  text: string;
  media?: string;
  poll?: string;
  code?: string;
  codeLang?: string;
  adult?: number;
  publishAt?: number;
  replyTo?: string | null;
  quote?: string;
  // Forum topic id of a held group message ('' or absent for «Общее»).
  topic?: string;
  // A held sticker message.
  sticker?: string;
};
export type SpamSubmission = {
  kind: SpamKind;
  targetId: string;
  actorId: string;
  contextId: string;
  payload: SpamPayload;
};
export type SpamSettings = {
  domains: string[];
  raidUntil: number;
  updated: number;
};
export type SpamReview = SpamSubmission & {
  id: string;
  text: string;
  payload: SpamPayload;
  reasons: string[];
  status: 'pending' | 'approved' | 'rejected';
  created: number;
  reviewedAt: number;
  reviewedBy: string | null;
  note: string;
  name: string;
  handle: string | null;
  contextName: string | null;
};
export type QueuedSubmission = {
  ok: true;
  queued: true;
  id: string;
  notice: string;
};
