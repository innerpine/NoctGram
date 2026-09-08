export type NegotiationState = {
  negotiation: number;
  restartRequested: number;
  offer?: string | null;
  answer?: string | null;
};
export type CallCandidate = {
  id: number;
  negotiation: number;
  candidate: string;
};
type Pending = { type: 'offer' | 'answer'; negotiation: number; sdp: string };
type Outgoing = {
  key: string;
  negotiation: number;
  candidate: RTCIceCandidateInit;
};
type Options = {
  caller: boolean;
  pc: RTCPeerConnection;
  send: (body: Record<string, unknown>) => Promise<unknown>;
  onState: (state: 'connected' | 'connecting' | 'reconnecting') => void;
  now?: () => number;
};
export class CallConnectionExpired extends Error {}

/** One offerer per call. HTTP retries reuse the same SDP and ICE keys. */
export class CallConnection {
  readonly pc: RTCPeerConnection;
  cursor = 0;
  connectedAt = 0;
  private options: Options;
  private now: () => number;
  private closed = false;
  private revision = 0;
  private remoteRevision = 0;
  private pending: Pending | null = null;
  private outgoing: Outgoing[] = [];
  private recoverySince = 0;
  private lastOfferAt = 0;
  private lastRestartRequest = 0;
  private attempts = 0;
  private created: number;
  private forcedRecovery = false;
  private working: Promise<void> = Promise.resolve();
  constructor(options: Options) {
    this.options = options;
    this.pc = options.pc;
    this.now = options.now || Date.now;
    this.created = this.now();
    this.pc.onicecandidate = (event) => {
      if (!event.candidate || this.closed || !this.revision) return;
      const candidate = event.candidate.toJSON();
      const fragment = this.pc.localDescription?.sdp
        .match(/^a=ice-ufrag:(.+)$/m)?.[1]
        .trim();
      if (
        candidate.usernameFragment &&
        fragment &&
        candidate.usernameFragment !== fragment
      )
        return;
      if (this.outgoing.length < 200)
        this.outgoing.push({
          key: crypto.randomUUID(),
          negotiation: this.revision,
          candidate,
        });
    };
    const connectionChange = () => {
      if (this.closed) return;
      if (
        this.pc.connectionState === 'connected' &&
        !['failed', 'disconnected'].includes(this.pc.iceConnectionState)
      ) {
        this.connectedAt ||= this.now();
        this.recoverySince = 0;
        this.attempts = 0;
        this.forcedRecovery = false;
        this.options.onState('connected');
      } else if (
        ['failed', 'disconnected'].includes(this.pc.connectionState) ||
        ['failed', 'disconnected'].includes(this.pc.iceConnectionState)
      ) {
        this.recoverySince ||= this.now();
        if (
          this.pc.connectionState === 'failed' ||
          this.pc.iceConnectionState === 'failed'
        )
          this.forcedRecovery = true;
        this.options.onState('reconnecting');
      }
    };
    this.pc.onconnectionstatechange = connectionChange;
    this.pc.oniceconnectionstatechange = connectionChange;
  }
  requestRecovery() {
    if (this.closed) return;
    this.forcedRecovery = true;
    this.recoverySince ||= this.now();
    this.options.onState('reconnecting');
  }
  close() {
    this.closed = true;
    this.outgoing = [];
    this.pending = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.close();
  }
  sync(state: NegotiationState, candidates: CallCandidate[]) {
    const run = this.working.then(() => this.advance(state, candidates));
    this.working = run.catch(() => {});
    return run;
  }
  private async publish() {
    const pending = this.pending;
    if (!pending || this.closed) return;
    await this.options.send({
      type: pending.type,
      negotiation: pending.negotiation,
      sdp: pending.sdp,
    });
    if (!this.closed && this.pending === pending) this.pending = null;
  }
  private async offer(revision: number) {
    if (this.closed) return;
    if (this.pc.signalingState === 'have-local-offer')
      await this.pc.setLocalDescription({ type: 'rollback' });
    if (this.closed) return;
    const previousRevision = this.revision;
    const previousOutgoing = this.outgoing;
    this.revision = revision;
    this.outgoing = this.outgoing.filter((c) => c.negotiation === revision);
    try {
      this.pc.restartIce();
      const offer = await this.pc.createOffer({ iceRestart: revision > 1 });
      if (this.closed) return;
      await this.pc.setLocalDescription(offer);
    } catch (error) {
      if (!this.closed) {
        this.revision = previousRevision;
        this.outgoing = previousOutgoing;
      }
      throw error;
    }
    if (this.closed) return;
    this.lastOfferAt = this.now();
    if (revision > 1) this.attempts++;
    this.pending = {
      type: 'offer',
      negotiation: revision,
      sdp: this.pc.localDescription!.sdp,
    };
    await this.publish();
  }
  private async advance(state: NegotiationState, candidates: CallCandidate[]) {
    if (this.closed) return;
    const now = this.now();
    if (
      (!this.connectedAt && now - this.created > 60000) ||
      (this.recoverySince && now - this.recoverySince > 55000)
    )
      throw new CallConnectionExpired(
        'Не удалось восстановить соединение. Проверьте сеть и позвоните ещё раз.',
      );
    if (this.pending && state.negotiation > this.pending.negotiation)
      this.pending = null;
    await this.publish();
    if (this.closed) return;
    if (this.options.caller) {
      if (
        state.answer &&
        state.negotiation === this.revision &&
        this.remoteRevision !== state.negotiation &&
        this.pc.signalingState === 'have-local-offer'
      ) {
        await this.pc.setRemoteDescription({
          type: 'answer',
          sdp: state.answer,
        });
        if (this.closed) return;
        this.remoteRevision = state.negotiation;
      }
      const recover =
        this.forcedRecovery ||
        (this.recoverySince && now - this.recoverySince >= 4000) ||
        (state.negotiation > 0 &&
          state.restartRequested === state.negotiation) ||
        (!this.connectedAt &&
          this.lastOfferAt &&
          now - this.lastOfferAt >= 12000);
      if (!this.pc.localDescription && !this.pending)
        await this.offer(state.negotiation + 1);
      else if (
        recover &&
        !this.pending &&
        state.negotiation >= this.revision &&
        now - this.lastOfferAt >= 8000 &&
        this.attempts < 4
      ) {
        this.recoverySince ||= now;
        this.options.onState('reconnecting');
        await this.offer(state.negotiation + 1);
        this.forcedRecovery = false;
      }
    } else if (state.offer && state.negotiation > this.remoteRevision) {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: state.offer });
      if (this.closed) return;
      this.revision = state.negotiation;
      this.outgoing = this.outgoing.filter(
        (c) => c.negotiation === this.revision,
      );
      const answer = await this.pc.createAnswer();
      if (this.closed) return;
      await this.pc.setLocalDescription(answer);
      if (this.closed) return;
      this.remoteRevision = state.negotiation;
      this.pending = {
        type: 'answer',
        negotiation: this.revision,
        sdp: this.pc.localDescription!.sdp,
      };
      await this.publish();
    }
    if (this.closed) return;
    if (
      !this.options.caller &&
      this.recoverySince &&
      (this.forcedRecovery || now - this.recoverySince >= 4000) &&
      state.negotiation > 0 &&
      this.lastRestartRequest !== state.negotiation
    ) {
      await this.options.send({
        type: 'restart',
        negotiation: state.negotiation,
      });
      if (this.closed) return;
      this.lastRestartRequest = state.negotiation;
    }
    // Future candidates remain behind the cursor until their SDP is applied.
    for (const item of candidates) {
      if (this.closed || item.id <= this.cursor) continue;
      if (item.negotiation > this.remoteRevision || !this.pc.remoteDescription)
        break;
      if (item.negotiation === this.remoteRevision) {
        try {
          const candidate = JSON.parse(item.candidate) as RTCIceCandidateInit;
          const fragment = this.pc.remoteDescription.sdp
            .match(/^a=ice-ufrag:(.+)$/m)?.[1]
            .trim();
          if (
            !candidate.usernameFragment ||
            !fragment ||
            candidate.usernameFragment === fragment
          )
            await this.pc.addIceCandidate(candidate);
        } catch {
          /* One malformed/stale candidate must not block the remaining candidates. */
        }
      }
      this.cursor = item.id;
    }
    if (this.closed || this.pending) return;
    const outgoing = this.outgoing
      .filter((item) => item.negotiation === this.revision)
      .slice(0, 20);
    if (outgoing.length) {
      await this.options.send({
        type: 'ice',
        negotiation: this.revision,
        candidates: outgoing.map(({ key, candidate }) => ({ key, candidate })),
      });
      if (!this.closed) {
        const sent = new Set(outgoing.map((v) => v.key));
        this.outgoing = this.outgoing.filter((v) => !sent.has(v.key));
      }
    }
  }
}
