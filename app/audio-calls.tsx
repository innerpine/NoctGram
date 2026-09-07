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
import { request, type Person } from '@/lib/client';
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
};
type Session = {
  call: Call;
  stream: MediaStream | null;
  pc: RTCPeerConnection | null;
  out: { key: string; candidate: RTCIceCandidateInit }[];
  cursor: number;
  connected: number;
  disconnect: number;
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
      s.pc?.close();
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
    generation.current++;
    const c = session.current?.call;
    release();
    setBusy(false);
    operation.current = false;
    if (c) {
      if (!silent) {
        setCall({ ...c, status: 'ended', reason });
        setStatus(endLabels[reason] || 'Звонок завершён');
      }
      try {
        await request('', {
          action: 'callEnd',
          id: c.id,
          device: device.current,
          reason,
        });
      } catch (e) {
        if (!silent) setError(errorText(e));
      }
    }
    if (silent) setOpen(false);
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
    };
    session.current = {
      call: c,
      stream: null,
      pc: null,
      out: [],
      cursor: 0,
      connected: 0,
      disconnect: 0,
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
      await request('', {
        action: 'callStart',
        id: c.id,
        peer: peer.id,
        device: device.current,
      });
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
      await request('', {
        action: 'callAccept',
        id: c.id,
        device: device.current,
      });
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
      t: ReturnType<typeof setTimeout>,
      failuresSince = 0;
    const tick = async () => {
      try {
        if (!me || disabled) {
          if (session.current) await end('completed', true);
          return;
        }
        const before = session.current;
        if (before?.call.status === 'preparing' || operation.current) return;
        const data = await request<{
          call: Call | null;
          signals: { id: number; candidate: string }[];
        }>(
          '?action=callState&device=' +
            device.current +
            (before
              ? '&id=' +
                encodeURIComponent(before.call.id) +
                '&after=' +
                before.cursor
              : ''),
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
            out: [],
            cursor: 0,
            connected: 0,
            disconnect: 0,
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
          failuresSince = 0;
          return;
        }
        if (!c.deviceOwned) {
          release();
          setCall({ ...c, status: 'ended' });
          setStatus('Звонок принят на другом устройстве');
          return;
        }
        if (!s.connected && c.acceptedAt && Date.now() - c.acceptedAt > 45000) {
          await end('failed');
          return;
        }
        if (!s.stream) {
          await end('failed');
          return;
        }
        if (!s.pc) {
          const cfg = await request<{ iceServers: RTCIceServer[] }>(
            '?action=callConfig',
          );
          if (stopped || session.current !== s) return;
          const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
          s.pc = pc;
          s.stream
            .getTracks()
            .forEach((track) => pc.addTrack(track, s.stream!));
          setStatus('Соединяем…');
          pc.onicecandidate = (e) => {
            if (e.candidate && session.current === s)
              s.out.push({
                key: crypto.randomUUID(),
                candidate: e.candidate.toJSON(),
              });
          };
          pc.ontrack = (e) => {
            if (session.current !== s || !audio.current) return;
            audio.current.srcObject =
              e.streams[0] || new MediaStream([e.track]);
            void audio.current.play().catch(() => {
              if (session.current === s) setNeedsPlay(true);
            });
          };
          pc.onconnectionstatechange = () => {
            if (session.current !== s) return;
            if (pc.connectionState === 'connected') {
              s.connected ||= Date.now();
              s.disconnect = 0;
              setStatus('На связи');
            } else if (pc.connectionState === 'failed') void end('failed');
            else if (pc.connectionState === 'disconnected') {
              s.disconnect ||= Date.now();
              setStatus('Восстанавливаем связь…');
            }
          };
        }
        const pc = s.pc;
        const signal = (type: string, sdp: string) =>
          request('', {
            action: 'callSignal',
            id: c.id,
            device: device.current,
            type,
            sdp,
          });
        if (c.caller === me && !c.offer) {
          if (!pc.localDescription) {
            await pc.setLocalDescription(await pc.createOffer());
          }
          if (session.current !== s) return;
          await signal('offer', pc.localDescription!.sdp);
        }
        if (c.callee === me && c.offer) {
          if (!pc.remoteDescription)
            await pc.setRemoteDescription({ type: 'offer', sdp: c.offer });
          if (!c.answer) {
            if (!pc.localDescription)
              await pc.setLocalDescription(await pc.createAnswer());
            if (session.current !== s) return;
            await signal('answer', pc.localDescription!.sdp);
          }
        }
        if (c.caller === me && c.answer && !pc.remoteDescription)
          await pc.setRemoteDescription({ type: 'answer', sdp: c.answer });
        if (session.current !== s) return;
        if (pc.remoteDescription)
          for (const item of data.signals) {
            await pc.addIceCandidate(JSON.parse(item.candidate));
            s.cursor = item.id;
          }
        const outgoing = s.out.slice(0, 20);
        if (outgoing.length) {
          await request('', {
            action: 'callSignal',
            id: c.id,
            device: device.current,
            type: 'ice',
            candidates: outgoing,
          });
          s.out.splice(0, outgoing.length);
        }
        if (s.connected)
          setSeconds(Math.floor((Date.now() - s.connected) / 1000));
        if (
          (s.disconnect && Date.now() - s.disconnect > 15000) ||
          (!s.connected && c.acceptedAt && Date.now() - c.acceptedAt > 45000)
        ) {
          setError('Не удалось установить связь. Попробуйте ещё раз.');
          await end('failed');
        }
        failuresSince = 0;
      } catch (e) {
        if (!stopped && session.current) {
          failuresSince ||= Date.now();
          if (Date.now() - failuresSince > 20000) {
            setError(errorText(e));
            await end('failed');
          }
        }
      } finally {
        if (!stopped) t = setTimeout(tick, session.current ? 1000 : 3000);
      }
    };
    void tick();
    const unload = () => {
      const c = session.current?.call;
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
    window.addEventListener('pagehide', unload);
    return () => {
      stopped = true;
      live.current = false;
      clearTimeout(t);
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
