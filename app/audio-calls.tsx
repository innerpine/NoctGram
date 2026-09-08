'use client';
import { DisplayName } from './profile-identity';
/* eslint-disable react/react-compiler, jsx-a11y/media-has-caption */
/* Live audio has no prerecorded captions. */
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { type Person } from '@/lib/client';
import { callRequest as request, CallHttpError } from '@/lib/call-http';
import {
  CallConnection,
  CallConnectionExpired,
  type CallCandidate,
} from '@/lib/call-connection';
import type { CallIceConfiguration } from '@/lib/turn';
import type { Appearance } from '@/lib/appearance';
import { Avatar } from './post-card';
type Call = Appearance & {
  id: string;
  caller: string;
  callee: string;
  name: string;
  avatar: string;
  handle: string;
  status: string;
  reason?: string;
  deviceOwned: boolean;
  acceptedAt?: number;
  offer?: string;
  answer?: string;
  negotiation: number;
  restartRequested: number;
};
type Session = {
  call: Call;
  stream: MediaStream | null;
  pc: RTCPeerConnection | null;
  connection: CallConnection | null;
  abort: AbortController;
  participating: boolean;
  failuresSince: number;
  configPending: boolean;
  configRetryAt: number;
  syncing: boolean;
};
function errorText(e: unknown) {
  return e instanceof DOMException && e.name === 'NotAllowedError'
    ? 'Разреши доступ к микрофону в браузере.'
    : e instanceof DOMException && e.name === 'NotFoundError'
      ? 'Микрофон не найден.'
      : (e as Error).message || 'Не удалось соединиться';
}
const endLabels: Record<string, string> = {
  declined: 'Звонок отклонён',
  cancelled: 'Вызов отменён',
  completed: 'Звонок завершён',
  failed: 'Не удалось соединиться',
  missed: 'Нет ответа',
  disconnected: 'Связь прервалась',
};
export function useAudioCalls(me: string | undefined, disabled: boolean) {
  const [call, setCall] = useState<Call | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [muted, setMuted] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [needsPlay, setNeedsPlay] = useState(false),
    [seconds, setSeconds] = useState(0);
  const device = useRef(''),
    session = useRef<Session | null>(null),
    audio = useRef<HTMLAudioElement>(null),
    generation = useRef(0),
    live = useRef(false),
    operation = useRef(false);
  if (!device.current && typeof crypto !== 'undefined')
    device.current = crypto.randomUUID();
  function release() {
    const s = session.current;
    session.current = null;
    if (s) {
      s.abort.abort();
      s.connection?.close();
      if (!s.connection) s.pc?.close();
      s.stream?.getTracks().forEach((t) => t.stop());
    }
    if (audio.current) {
      audio.current.pause();
      audio.current.srcObject = null;
    }
    setMuted(false);
    setNeedsPlay(false);
  }
  async function end(reason = 'completed', silent = false) {
    const ending = ++generation.current;
    const c = session.current?.call;
    release();
    if (silent) setOpen(false);
    setBusy(false);
    operation.current = false;
    if (c) {
      if (!silent) {
        setCall({ ...c, status: 'ended', reason });
        setStatus(endLabels[reason] || 'Звонок завершён');
      }
      try {
        await request(
          '',
          {
            action: 'callEnd',
            id: c.id,
            device: device.current,
            reason,
          },
          { attempts: 2 },
        );
      } catch (e) {
        if (!silent && generation.current === ending) setError(errorText(e));
      }
    }
  }
  async function transition(action: 'callStart' | 'callAccept', s: Session) {
    const signal = s.abort.signal;
    try {
      await request(
        '',
        {
          action,
          id: s.call.id,
          peer: s.call.callee,
          device: device.current,
        },
        { attempts: 2, signal },
      );
    } catch (error) {
      if (
        signal.aborted ||
        !(error instanceof CallHttpError) ||
        !([0, 200, 408].includes(error.status) || error.status >= 500)
      )
        throw error;
      // A lost HTTP response does not mean the server rejected the call.
      const state = await request<{ call: Call | null }>(
        '?action=callState&id=' +
          encodeURIComponent(s.call.id) +
          '&device=' +
          device.current,
        undefined,
        { signal },
      );
      if (
        state.call?.id !== s.call.id ||
        !state.call.deviceOwned ||
        !(
          action === 'callStart' ? ['ringing', 'accepted'] : ['accepted']
        ).includes(state.call.status)
      )
        throw error;
    }
  }
  async function microphone(token: number) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error('Для микрофона нужен HTTPS или localhost.');
    if (!window.RTCPeerConnection)
      throw new Error('Браузер не поддерживает аудиозвонки.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (token !== generation.current || !live.current) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    return stream;
  }
  async function start(peer: Person) {
    if (!me || disabled || operation.current || session.current) return;
    operation.current = true;
    const token = ++generation.current;
    const c: Call = {
      ...peer,
      id: crypto.randomUUID(),
      caller: me,
      callee: peer.id,
      name: peer.name,
      avatar: peer.avatar,
      handle: peer.handle,
      status: 'preparing',
      deviceOwned: true,
      negotiation: 0,
      restartRequested: 0,
    };
    session.current = {
      call: c,
      stream: null,
      pc: null,
      connection: null,
      abort: new AbortController(),
      participating: true,
      failuresSince: 0,
      configPending: false,
      configRetryAt: 0,
      syncing: false,
    };
    setCall(c);
    setOpen(true);
    setBusy(true);
    setError('');
    setStatus('Подключаем микрофон…');
    setSeconds(0);
    try {
      const stream = await microphone(token);
      if (!stream) return;
      const s = session.current;
      if (!s || s.call.id !== c.id) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      s.stream = stream;
      await transition('callStart', s);
      if (token !== generation.current) {
        void request('', {
          action: 'callEnd',
          id: c.id,
          device: device.current,
          reason: 'cancelled',
        }).catch(() => {});
        return;
      }
      s.call = { ...c, status: 'ringing' };
      setCall(s.call);
      setStatus('Вызываем…');
    } catch (e) {
      if (token === generation.current) {
        release();
        setCall({ ...c, status: 'ended' });
        setStatus('Звонок не начался');
        setError(errorText(e));
      }
      void request('', {
        action: 'callEnd',
        id: c.id,
        device: device.current,
        reason: 'failed',
      }).catch(() => {});
    } finally {
      if (token === generation.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function accept() {
    const c = session.current?.call;
    if (!c || !me || c.callee !== me || operation.current) return;
    operation.current = true;
    const token = ++generation.current;
    const accepting = session.current!;
    accepting.participating = true;
    setBusy(true);
    setError('');
    setStatus('Подключаем микрофон…');
    try {
      const stream = await microphone(token);
      if (!stream) return;
      if (session.current?.call.id !== c.id) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      session.current.stream = stream;
      await transition('callAccept', accepting);
      if (token !== generation.current) return;
      session.current.call = { ...c, status: 'accepted', deviceOwned: true };
      setCall(session.current.call);
      setStatus('Соединяем…');
    } catch (e) {
      if (token === generation.current) {
        setError(errorText(e));
        void end('failed');
      }
    } finally {
      if (token === generation.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    live.current = true;
    let stopped = false,
      t: ReturnType<typeof setTimeout>;
    const polling = new AbortController();
    const fail = (s: Session, error: unknown) => {
      if (stopped || session.current !== s) return;
      s.failuresSince ||= Date.now();
      if (
        error instanceof CallConnectionExpired ||
        (error instanceof CallHttpError && [401, 403].includes(error.status)) ||
        Date.now() - s.failuresSince > 55000
      ) {
        setError(errorText(error));
        void end('failed');
      }
    };
    const tick = async () => {
      const before = session.current;
      try {
        if (!me || disabled) {
          if (session.current) await end('completed', true);
          return;
        }
        if (before?.call.status === 'preparing' || operation.current) return;
        const data = await request<{
          call: Call | null;
          signals: CallCandidate[];
        }>(
          '?action=callState&device=' +
            device.current +
            (before
              ? '&id=' +
                encodeURIComponent(before.call.id) +
                '&after=' +
                (before.connection?.cursor || 0)
              : ''),
          undefined,
          { signal: polling.signal },
        );
        if (stopped || before !== session.current) return;
        const c = data.call;
        if (!c) {
          if (before) {
            release();
            setCall({
              ...before.call,
              status: 'ended',
              reason: 'disconnected',
            });
            setStatus('Звонок завершён');
          }
          return;
        }
        if (c.status === 'ended') {
          generation.current++;
          release();
          setCall(c);
          setStatus(endLabels[c.reason || ''] || 'Звонок завершён');
          return;
        }
        if (!before) {
          if (c.caller === me || c.status !== 'ringing') return;
          session.current = {
            call: c,
            stream: null,
            pc: null,
            connection: null,
            abort: new AbortController(),
            participating: false,
            failuresSince: 0,
            configPending: false,
            configRetryAt: 0,
            syncing: false,
          };
          setOpen(true);
          setError('');
          setSeconds(0);
          setStatus('Входящий аудиозвонок');
        }
        const s = session.current!;
        s.call = c;
        setCall(c);
        if (c.status !== 'accepted') {
          s.failuresSince = 0;
          return;
        }
        if (!c.deviceOwned) {
          release();
          setCall({ ...c, status: 'ended' });
          setStatus('Звонок принят на другом устройстве');
          return;
        }
        if (!s.stream) {
          await end('failed');
          return;
        }
        // Polling/heartbeat stays independent from slow TURN and SDP requests.
        if (!s.pc && !s.configPending && Date.now() >= s.configRetryAt) {
          s.configPending = true;
          void request<CallIceConfiguration>(
            '?action=callConfig&id=' +
              encodeURIComponent(c.id) +
              '&device=' +
              device.current,
            undefined,
            { signal: s.abort.signal },
          )
            .then((cfg) => {
              if (stopped || session.current !== s) return;
              const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
              s.pc = pc;
              s.stream!.getTracks().forEach((track) =>
                pc.addTrack(track, s.stream!),
              );
              s.connection = new CallConnection({
                caller: c.caller === me,
                pc,
                send: (body) =>
                  request(
                    '',
                    {
                      action: 'callSignal',
                      id: c.id,
                      device: device.current,
                      ...body,
                    },
                    { signal: s.abort.signal },
                  ),
                onState: (state) => {
                  if (session.current === s)
                    setStatus(
                      state === 'connected'
                        ? 'На связи'
                        : state === 'reconnecting'
                          ? 'Восстанавливаем связь…'
                          : 'Соединяем…',
                    );
                },
              });
              pc.ontrack = (event) => {
                if (session.current !== s || !audio.current) return;
                audio.current.srcObject =
                  event.streams[0] || new MediaStream([event.track]);
                void audio.current.play().catch(() => {
                  if (session.current === s) setNeedsPlay(true);
                });
              };
            })
            .catch((error) => {
              s.configRetryAt = Date.now() + 10000;
              fail(s, error);
            })
            .finally(() => {
              s.configPending = false;
            });
        }
        if (s.connection && !s.syncing) {
          s.syncing = true;
          void s.connection
            .sync(c, data.signals)
            .then(() => {
              s.failuresSince = 0;
            })
            .catch((error) => fail(s, error))
            .finally(() => {
              s.syncing = false;
            });
        }
        if (s.connection?.connectedAt)
          setSeconds(
            Math.floor((Date.now() - s.connection.connectedAt) / 1000),
          );
      } catch (e) {
        if (!stopped && before && session.current === before) fail(before, e);
      } finally {
        if (!stopped) t = setTimeout(tick, session.current ? 1000 : 3000);
      }
    };
    void tick();
    const unload = () => {
      const c = session.current?.participating ? session.current.call : null;
      generation.current++;
      operation.current = false;
      release();
      setBusy(false);
      setOpen(false);
      setCall(null);
      if (c)
        void fetch('/api/social', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'callEnd',
            id: c.id,
            device: device.current,
            reason: 'completed',
          }),
          keepalive: true,
        }).catch(() => {});
    };
    const recover = () => session.current?.connection?.requestRecovery();
    const network = (navigator as Navigator & { connection?: EventTarget })
      .connection;
    window.addEventListener('online', recover);
    network?.addEventListener('change', recover);
    window.addEventListener('pagehide', unload);
    return () => {
      stopped = true;
      live.current = false;
      clearTimeout(t);
      polling.abort();
      window.removeEventListener('online', recover);
      network?.removeEventListener('change', recover);
      window.removeEventListener('pagehide', unload);
      unload();
    };
  }, [me, disabled]);
  const incoming = call?.callee === me && call?.status === 'ringing';
  const panel = (
    <>
      <audio ref={audio} autoPlay />
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            if (session.current)
              void end(incoming ? 'declined' : 'cancelled', true);
            else setOpen(false);
          }
        }}
      >
        <DialogContent
          className="noct-dialog call-dialog"
          showCloseButton={false}
        >
          <DialogTitle>Аудиозвонок</DialogTitle>
          <DialogDescription>Один на один в Noctgram</DialogDescription>
          {call && (
            <>
              <div
                className={
                  'call-avatar ' + (call.status === 'ringing' ? 'calling' : '')
                }
              >
                <Avatar person={call} size={88} />
              </div>
              <h2>
                <DisplayName person={call} />
              </h2>
              <output>
                {status}
                {seconds > 0 && call.status !== 'ended'
                  ? ' · ' +
                    Math.floor(seconds / 60) +
                    ':' +
                    String(seconds % 60).padStart(2, '0')
                  : ''}
              </output>
              {error && (
                <p className="realtime-error" role="alert">
                  {error}
                </p>
              )}
              {needsPlay && (
                <button
                  className="secondary"
                  onClick={() =>
                    void audio.current
                      ?.play()
                      .then(() => setNeedsPlay(false))
                      .catch(() =>
                        setError('Браузер не разрешил воспроизвести звук.'),
                      )
                  }
                >
                  <Volume2 size={17} /> Включить звук собеседника
                </button>
              )}
              <div className="call-actions">
                {incoming && (
                  <button
                    className="call-accept"
                    disabled={busy || disabled}
                    aria-label="Принять звонок"
                    onClick={() => void accept()}
                  >
                    <Phone size={24} />
                  </button>
                )}
                {call.status === 'accepted' && call.deviceOwned && (
                  <button
                    className={'secondary ' + (muted ? 'selected' : '')}
                    aria-pressed={muted}
                    aria-label={
                      muted ? 'Включить микрофон' : 'Выключить микрофон'
                    }
                    onClick={() => {
                      session.current?.stream
                        ?.getAudioTracks()
                        .forEach((track) => {
                          track.enabled = muted;
                        });
                      setMuted((v) => !v);
                    }}
                  >
                    {muted ? <MicOff size={23} /> : <Mic size={23} />}
                  </button>
                )}
                {call.status === 'ended' ? (
                  <button className="secondary" onClick={() => setOpen(false)}>
                    Закрыть
                  </button>
                ) : (
                  <button
                    className="call-hangup"
                    aria-label={
                      incoming ? 'Отклонить звонок' : 'Завершить звонок'
                    }
                    onClick={() =>
                      void end(
                        incoming
                          ? 'declined'
                          : call.status === 'ringing' ||
                              call.status === 'preparing'
                            ? 'cancelled'
                            : 'completed',
                      )
                    }
                  >
                    <PhoneOff size={24} />
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
  return { start, panel, active: !!session.current };
}
