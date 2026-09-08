/**
 * Noctgram call-client regression tests: real TypeScript modules, fake RTC/fetch.
 * Run from the project: node --test tests/call-client.test.mjs
 * Or set NOCT_TEST_ROOT to the checkout. No browser, network, or checkout writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = [
  process.env.NOCT_TEST_ROOT,
  process.cwd(),
  path.resolve(here, '..'),
]
  .filter(Boolean)
  .find((p) => existsSync(path.join(p, 'lib/call-connection.ts')));
assert.ok(root, 'Run from the checkout or set NOCT_TEST_ROOT');
const projectRequire = createRequire(path.join(root, 'package.json'));
const ts = projectRequire('typescript');
const sourceCache = new Map();
function source(file) {
  if (!sourceCache.has(file))
    sourceCache.set(
      file,
      ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: file,
      }).outputText,
    );
  return sourceCache.get(file);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(predicate, message = 'asynchronous checkpoint') {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Not reached: ' + message);
}
const copy = (value) => structuredClone(value);
function fakeClock() {
  let now = 100000,
    nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) {
      const id = ++nextId;
      timers.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of timers)
        if (t.due <= now) {
          timers.delete(id);
          t.fn();
        }
    },
    pending: () => timers.size,
  };
}
function modules({
  clock = fakeClock(),
  fetch = () => {
    throw new Error('Unexpected fetch');
  },
} = {}) {
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    AbortController,
    DOMException,
    Response,
    Request,
    Headers,
    fetch,
    setTimeout: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeout: (id) => clock.clearTimeout(id),
  });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const localRequire = (id) => {
      assert.ok(
        id.startsWith('.'),
        'Only local pure modules are allowed: ' + id,
      );
      return load(path.resolve(path.dirname(file), id + '.ts'));
    };
    const wrapper = new vm.Script(
      '(function(require,module,exports){' + source(file) + '\n})',
      { filename: file },
    ).runInContext(context);
    wrapper(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return {
    ...load(path.join(root, 'lib/call-connection.ts')),
    ...load(path.join(root, 'lib/call-http.ts')),
    clock,
  };
}
function sdp(fragment) {
  return `v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=ice-ufrag:${fragment}\r\na=ice-pwd:abcdefghijklmnopqrstuvwx\r\n`;
}
function candidate(fragment, tag = 'good') {
  return {
    candidate: `${tag}:1 1 udp 100 192.0.2.1 40000 typ host`,
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: fragment,
  };
}
function signal(id, negotiation, value) {
  return {
    id,
    negotiation,
    candidate: typeof value === 'string' ? value : JSON.stringify(value),
  };
}
function state(negotiation = 0, patch = {}) {
  return {
    negotiation,
    restartRequested: 0,
    offer: negotiation ? sdp('offer-' + negotiation) : null,
    answer: null,
    ...patch,
  };
}
class FakeRTC {
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription = null;
  remoteDescription = null;
  onicecandidate = null;
  ontrack = null;
  onconnectionstatechange = null;
  oniceconnectionstatechange = null;
  closed = false;
  operations = [];
  hooks = new Map();
  offerCount = 0;
  answerCount = 0;
  stableLocal = null;
  hook(method, fn) {
    const list = this.hooks.get(method) || [];
    list.push(fn);
    this.hooks.set(method, list);
  }
  async step(method, args) {
    this.operations.push({ method, args: copy(args) });
    const fn = this.hooks.get(method)?.shift();
    if (fn) await fn(args);
    if (this.closed)
      throw new DOMException(
        'The peer connection is closed',
        'InvalidStateError',
      );
  }
  restartIce() {
    if (this.closed) throw new DOMException('Closed', 'InvalidStateError');
    this.operations.push({ method: 'restartIce' });
  }
  async createOffer(options) {
    await this.step('createOffer', options);
    return { type: 'offer', sdp: sdp('local-offer-' + ++this.offerCount) };
  }
  async createAnswer() {
    await this.step('createAnswer', null);
    assert.equal(
      this.signalingState,
      'have-remote-offer',
      'createAnswer needs a remote offer',
    );
    return { type: 'answer', sdp: sdp('local-answer-' + ++this.answerCount) };
  }
  async setLocalDescription(description) {
    await this.step('setLocalDescription', description);
    if (description.type === 'rollback') {
      this.localDescription = this.stableLocal;
      this.signalingState = 'stable';
      return;
    }
    if (description.type === 'offer')
      assert.equal(this.signalingState, 'stable');
    if (description.type === 'answer')
      assert.equal(this.signalingState, 'have-remote-offer');
    this.localDescription = copy(description);
    this.signalingState =
      description.type === 'offer' ? 'have-local-offer' : 'stable';
    if (description.type === 'answer') this.stableLocal = this.localDescription;
  }
  async setRemoteDescription(description) {
    await this.step('setRemoteDescription', description);
    if (description.type === 'answer') {
      assert.equal(this.signalingState, 'have-local-offer');
      this.signalingState = 'stable';
      this.stableLocal = this.localDescription;
    } else {
      // Modern setRemoteDescription(offer) performs implicit rollback if needed.
      this.signalingState = 'have-remote-offer';
    }
    this.remoteDescription = copy(description);
  }
  async addIceCandidate(value) {
    await this.step('addIceCandidate', value);
    if (!this.remoteDescription)
      throw new DOMException('No remote description', 'InvalidStateError');
    if (value.candidate.startsWith('bad'))
      throw new DOMException('Malformed candidate', 'OperationError');
  }
  ice(value) {
    this.onicecandidate?.({
      candidate: value && { toJSON: () => copy(value) },
    });
  }
  connection(connection, ice = connection) {
    this.connectionState = connection;
    this.iceConnectionState = ice;
    this.onconnectionstatechange?.();
    this.oniceconnectionstatechange?.();
  }
  close() {
    this.closed = true;
    this.signalingState = 'closed';
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
    this.operations.push({ method: 'close' });
  }
  count(method) {
    return this.operations.filter((o) => o.method === method).length;
  }
}
function fixture(caller = true) {
  const clock = fakeClock(),
    api = modules({ clock }),
    pc = new FakeRTC(),
    sends = [],
    statuses = [];
  let sender = async () => ({ ok: true });
  const connection = new api.CallConnection({
    caller,
    pc,
    now: clock.now,
    send: async (body) => {
      sends.push(copy(body));
      return sender(body);
    },
    onState: (value) => statuses.push(value),
  });
  return {
    ...api,
    pc,
    connection,
    sends,
    statuses,
    setSender(fn) {
      sender = fn;
    },
  };
}
async function connectedCaller(h) {
  await h.connection.sync(state(), []);
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  h.pc.connection('connected');
}

test('offer retry preserves exact SDP even when ICE gathering changes localDescription', async () => {
  const h = fixture();
  let attempts = 0;
  h.setSender(async (body) => {
    if (body.type === 'offer' && ++attempts === 1)
      throw new Error('lost response');
  });
  await assert.rejects(h.connection.sync(state(), []), /lost response/);
  h.pc.localDescription.sdp += 'a=candidate:gathered-later\r\n';
  await h.connection.sync(state(1), []);
  assert.equal(h.sends.length, 2);
  assert.deepEqual(h.sends[0], h.sends[1]);
  assert.equal(h.pc.offerCount, 1);
  h.connection.close();
});
test('answer retry preserves exact SDP and does not recreate the answer', async () => {
  const h = fixture(false);
  let attempts = 0;
  h.setSender(async (body) => {
    if (body.type === 'answer' && ++attempts === 1)
      throw new Error('lost answer response');
  });
  await assert.rejects(h.connection.sync(state(1), []), /lost answer/);
  h.pc.localDescription.sdp += 'a=candidate:gathered-later\r\n';
  await h.connection.sync(state(1), []);
  assert.deepEqual(h.sends[0], h.sends[1]);
  assert.equal(h.pc.answerCount, 1);
  h.connection.close();
});
test('ICE retry preserves keys and drains acknowledged candidates exactly once', async () => {
  const h = fixture();
  await connectedCaller(h);
  h.pc.ice(candidate('local-offer-1'));
  let attempts = 0;
  h.setSender(async (body) => {
    if (body.type === 'ice' && ++attempts === 1)
      throw new Error('lost ICE response');
  });
  await assert.rejects(
    h.connection.sync(state(1, { answer: sdp('answer-1') }), []),
    /lost ICE/,
  );
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  const batches = h.sends.filter((v) => v.type === 'ice');
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0], batches[1]);
  h.connection.close();
});
test('ICE batching keeps candidates gathered during a pending send', async () => {
  const h = fixture();
  await connectedCaller(h);
  for (let i = 0; i < 25; i++)
    h.pc.ice(candidate('local-offer-1', 'good-' + i));
  const gate = deferred();
  h.setSender((body) =>
    body.type === 'ice' ? gate.promise : Promise.resolve(),
  );
  const pending = h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  await until(() => h.sends.some((v) => v.type === 'ice'));
  h.pc.ice(candidate('local-offer-1', 'added-during-send'));
  gate.resolve();
  await pending;
  h.setSender(async () => {});
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  assert.deepEqual(
    h.sends.filter((v) => v.type === 'ice').map((v) => v.candidates.length),
    [20, 6],
  );
  const keys = h.sends
    .filter((v) => v.type === 'ice')
    .flatMap((v) => v.candidates.map((c) => c.key));
  assert.equal(new Set(keys).size, 26);
  h.connection.close();
});
test('late local ICE with an obsolete usernameFragment is not transmitted', async () => {
  const h = fixture();
  await connectedCaller(h);
  h.pc.ice(candidate('obsolete'));
  h.pc.ice(null);
  h.pc.ice(candidate('local-offer-1'));
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  assert.equal(h.sends.find((v) => v.type === 'ice').candidates.length, 1);
  h.connection.close();
});
test('remote ICE waits for matching SDP; stale and malformed entries do not block later entries', async () => {
  const h = fixture(false);
  const early = signal(1, 1, candidate('offer-1'));
  await h.connection.sync(state(), [early]);
  assert.equal(h.connection.cursor, 0);
  assert.equal(h.pc.count('addIceCandidate'), 0);
  const batch = [
    early,
    signal(2, 0, candidate('old')),
    signal(3, 1, '{broken'),
    signal(4, 1, candidate('offer-1', 'bad')),
    signal(5, 1, candidate('wrong-ufrag')),
    signal(6, 1, candidate('offer-1')),
    signal(7, 2, candidate('offer-2')),
  ];
  await h.connection.sync(state(1), batch);
  assert.equal(h.connection.cursor, 6);
  assert.equal(h.pc.count('addIceCandidate'), 3);
  await h.connection.sync(state(2), batch);
  assert.equal(h.connection.cursor, 7);
  assert.equal(h.pc.count('addIceCandidate'), 4);
  h.connection.close();
});
test('callee applies each successive offer and answer once, including repeated server snapshots', async () => {
  const h = fixture(false);
  for (let rev = 1; rev <= 3; rev++) {
    await h.connection.sync(state(rev), []);
    await h.connection.sync(state(rev), []);
  }
  assert.deepEqual(
    h.sends.map((v) => [v.type, v.negotiation]),
    [
      ['answer', 1],
      ['answer', 2],
      ['answer', 3],
    ],
  );
  assert.equal(h.pc.count('setRemoteDescription'), 3);
  h.connection.close();
});
test('newer offer supersedes an unacknowledged old answer', async () => {
  const h = fixture(false);
  let failed = false;
  h.setSender(async (body) => {
    if (body.type === 'answer' && !failed) {
      failed = true;
      throw new Error('network');
    }
  });
  await assert.rejects(h.connection.sync(state(1), []));
  await h.connection.sync(state(2), []);
  assert.deepEqual(
    h.sends.map((v) => v.negotiation),
    [1, 2],
  );
  h.connection.close();
});
test('short disconnected interval recovers without starting another offer', async () => {
  const h = fixture();
  await connectedCaller(h);
  h.clock.advance(10000);
  h.pc.connection('disconnected');
  h.clock.advance(3000);
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  h.pc.connection('connected');
  h.clock.advance(2000);
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  assert.equal(h.pc.offerCount, 1);
  h.connection.close();
});
test('caller restarts after the disconnected grace interval and accepts the new answer', async () => {
  const h = fixture();
  await connectedCaller(h);
  h.clock.advance(10000);
  h.pc.connection('disconnected');
  h.clock.advance(3999);
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  assert.equal(h.pc.offerCount, 1);
  h.clock.advance(1);
  await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
  assert.equal(h.sends.at(-1).negotiation, 2);
  assert.equal(h.pc.signalingState, 'have-local-offer');
  await h.connection.sync(state(2, { answer: sdp('answer-2') }), []);
  assert.equal(h.pc.signalingState, 'stable');
  assert.equal(h.pc.remoteDescription.sdp, sdp('answer-2'));
  h.connection.close();
});
test('callee requests restart once per revision and never generates an offer', async () => {
  const h = fixture(false);
  await h.connection.sync(state(1), []);
  h.pc.connection('connected');
  h.clock.advance(10000);
  h.pc.connection('failed');
  await h.connection.sync(state(1), []);
  await h.connection.sync(state(1), []);
  h.connection.requestRecovery();
  await h.connection.sync(state(1), []);
  assert.equal(h.pc.offerCount, 0);
  assert.deepEqual(
    h.sends.filter((v) => v.type === 'restart'),
    [{ type: 'restart', negotiation: 1 }],
  );
  h.connection.close();
});
test('caller honors a callee restart request without duplicate offers from old snapshots', async () => {
  const h = fixture();
  await connectedCaller(h);
  h.clock.advance(10000);
  const old = state(1, { answer: sdp('answer-1'), restartRequested: 1 });
  await h.connection.sync(old, []);
  await h.connection.sync(old, []);
  assert.deepEqual(
    h.sends.filter((v) => v.type === 'offer').map((v) => v.negotiation),
    [1, 2],
  );
  h.connection.close();
});
test('simultaneous recovery keeps the caller as the only offerer', async () => {
  const caller = fixture(),
    callee = fixture(false);
  await connectedCaller(caller);
  await callee.connection.sync(state(1), []);
  callee.pc.connection('connected');
  caller.clock.advance(10000);
  callee.clock.advance(10000);
  caller.connection.requestRecovery();
  callee.connection.requestRecovery();
  await Promise.all([
    caller.connection.sync(state(1, { answer: sdp('answer-1') }), []),
    callee.connection.sync(state(1), []),
  ]);
  assert.equal(callee.pc.offerCount, 0);
  assert.equal(caller.pc.offerCount, 2);
  assert.equal(callee.sends.filter((v) => v.type === 'restart').length, 1);
  caller.connection.close();
  callee.connection.close();
});
test('reconnect is bounded to four restart offers and expires after its grace budget', async () => {
  const h = fixture();
  await connectedCaller(h);
  h.clock.advance(10000);
  h.pc.connection('failed');
  let rev = 1;
  for (let i = 0; i < 6; i++) {
    await h.connection.sync(state(rev, { answer: sdp('answer-' + rev) }), []);
    rev = h.sends.filter((v) => v.type === 'offer').at(-1).negotiation;
    h.clock.advance(8000);
  }
  assert.equal(h.sends.filter((v) => v.type === 'offer').length, 5);
  h.clock.advance(8001);
  await assert.rejects(
    h.connection.sync(state(rev, { answer: sdp('answer-' + rev) }), []),
    (e) => e instanceof h.CallConnectionExpired,
  );
  h.connection.close();
});
test('initial establishment has a bounded timeout', async () => {
  const h = fixture();
  h.clock.advance(60001);
  await assert.rejects(
    h.connection.sync(state(), []),
    (e) => e instanceof h.CallConnectionExpired,
  );
  assert.equal(h.sends.length, 0);
  h.connection.close();
});
test('sync serializes overlapping calls while an SDP send is pending', async () => {
  const h = fixture(),
    gate = deferred();
  h.setSender(() => gate.promise);
  const first = h.connection.sync(state(), []),
    second = h.connection.sync(state(), []);
  await until(() => h.sends.length === 1);
  assert.equal(h.pc.offerCount, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(h.sends.length, 1);
  h.connection.close();
});
test('close during createOffer prevents setLocalDescription and signaling', async () => {
  const h = fixture(),
    gate = deferred();
  h.pc.hook('createOffer', () => gate.promise);
  const pending = h.connection.sync(state(), []).catch((e) => e);
  await until(() => h.pc.count('createOffer'));
  h.connection.close();
  gate.resolve();
  await pending;
  assert.equal(h.pc.count('setLocalDescription'), 0);
  assert.equal(h.sends.length, 0);
  assert.equal(h.pc.onicecandidate, null);
  assert.equal(h.pc.onconnectionstatechange, null);
});
test('close during setRemoteDescription prevents answer creation', async () => {
  const h = fixture(false),
    gate = deferred();
  h.pc.hook('setRemoteDescription', () => gate.promise);
  const pending = h.connection.sync(state(1), []).catch((e) => e);
  await until(() => h.pc.count('setRemoteDescription'));
  h.connection.close();
  gate.resolve();
  await pending;
  assert.equal(h.pc.answerCount, 0);
  assert.equal(h.sends.length, 0);
});
test('close during SDP publish prevents queued ICE sends and ignores queued sync', async () => {
  const h = fixture(),
    gate = deferred();
  h.setSender(() => gate.promise);
  const pending = h.connection.sync(state(), []);
  await until(() => h.sends.length === 1);
  h.pc.ice(candidate('local-offer-1'));
  const queued = h.connection.sync(state(1), []);
  h.connection.close();
  gate.resolve();
  await Promise.all([pending, queued]);
  assert.deepEqual(
    h.sends.map((v) => v.type),
    ['offer'],
  );
  assert.equal(h.pc.ontrack, null);
});
test('close during addIceCandidate prevents subsequent remote or outgoing processing', async () => {
  const h = fixture();
  await connectedCaller(h);
  const gate = deferred();
  h.pc.hook('addIceCandidate', () => gate.promise);
  h.pc.ice(candidate('local-offer-1'));
  const pending = h.connection.sync(state(1, { answer: sdp('answer-1') }), [
    signal(1, 1, candidate('answer-1')),
    signal(2, 1, candidate('answer-1')),
  ]);
  await until(() => h.pc.count('addIceCandidate'));
  h.connection.close();
  gate.resolve();
  await pending;
  assert.equal(h.pc.count('addIceCandidate'), 1);
  assert.equal(h.sends.filter((v) => v.type === 'ice').length, 0);
});
for (const method of ['createOffer', 'setLocalDescription']) {
  test(`REGRESSION: transient ${method} error during restart must not wedge the unpublished revision`, async () => {
    const h = fixture();
    await connectedCaller(h);
    h.clock.advance(10000);
    h.pc.connection('failed');
    h.pc.hook(method, async () => {
      throw new DOMException(
        'Temporary RTC operation failure',
        'OperationError',
      );
    });
    await assert.rejects(
      h.connection.sync(state(1, { answer: sdp('answer-1') }), []),
      /Temporary/,
    );
    h.clock.advance(1000);
    await h.connection.sync(state(1, { answer: sdp('answer-1') }), []);
    assert.deepEqual(
      h.sends.filter((v) => v.type === 'offer').map((v) => v.negotiation),
      [1, 2],
      'A failed local RTC operation must remain retryable at revision 2',
    );
    h.connection.close();
  });
}

function json(body = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function abortable(signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    }),
  );
}
test('HTTP uses same-origin/no-store and sends GET or JSON POST accurately', async () => {
  const calls = [],
    h = modules({
      fetch: async (url, options) => {
        calls.push({ url, options });
        return json({ result: 1 });
      },
    });
  assert.equal((await h.callRequest('?action=callState')).result, 1);
  await h.callRequest('', { action: 'callSignal', negotiation: 3 });
  assert.equal(calls[0].url, '/api/social?action=callState');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(
    calls[1].options.body,
    '{"action":"callSignal","negotiation":3}',
  );
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(h.clock.pending(), 0);
});
test('HTTP network retry preserves exact call and ICE idempotency payload', async () => {
  const calls = [],
    h = modules({
      fetch: async (url, options) => {
        calls.push(options.body);
        if (calls.length === 1) throw new TypeError('network reset');
        return json();
      },
    });
  await h.callRequest(
    '',
    {
      action: 'callSignal',
      id: 'same-call',
      type: 'ice',
      candidates: [{ key: 'same-key', candidate: candidate('ufrag') }],
    },
    { attempts: 2 },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
  assert.equal(h.clock.pending(), 0);
});
for (const status of [408, 500, 502, 503, 504]) {
  test(`HTTP retries temporary ${status} responses with the same operation`, async () => {
    let calls = 0;
    const h = modules({
      fetch: async () =>
        ++calls === 1 ? json({ error: 'temporary' }, status) : json(),
    });
    await h.callRequest(
      '',
      { action: 'callAccept', id: 'same-call', device: 'same-device' },
      { attempts: 2 },
    );
    assert.equal(calls, 2);
    assert.equal(h.clock.pending(), 0);
  });
}
for (const status of [400, 401, 403, 404, 409, 413, 429]) {
  test(`HTTP does not retry terminal ${status} responses`, async () => {
    let calls = 0;
    const h = modules({
      fetch: async () => {
        calls++;
        return json({ error: 'rejected' }, status);
      },
    });
    await assert.rejects(
      h.callRequest('', { action: 'callAccept' }, { attempts: 3 }),
      (e) => e instanceof h.CallHttpError && e.status === status,
    );
    assert.equal(calls, 1);
    assert.equal(h.clock.pending(), 0);
  });
}
test('HTTP default attempt count is one and exhausted network errors are normalized', async () => {
  let calls = 0;
  const h = modules({
    fetch: async () => {
      calls++;
      throw new TypeError('private network details');
    },
  });
  await assert.rejects(
    h.callRequest('?action=callState'),
    (e) =>
      e instanceof h.CallHttpError &&
      e.status === 0 &&
      !e.message.includes('private'),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    h.callRequest('?action=callState', undefined, { attempts: 2 }),
  );
  assert.equal(calls, 3);
  assert.equal(h.clock.pending(), 0);
});
test('HTTP timeout aborts a hung fetch and retries within the bounded attempt count', async () => {
  const clock = fakeClock();
  let calls = 0;
  const h = modules({
    clock,
    fetch: async (url, options) => {
      calls++;
      return abortable(options.signal);
    },
  });
  const pending = h
    .callRequest('', { action: 'callAccept' }, { attempts: 2 })
    .catch((e) => e);
  await until(() => calls === 1);
  clock.advance(8500);
  await until(() => calls === 2);
  clock.advance(8500);
  const error = await pending;
  assert.equal(error.status, 0);
  assert.equal(calls, 2);
  assert.equal(clock.pending(), 0);
});
test('HTTP external abort during fetch prevents retries and clears deadline', async () => {
  const controller = new AbortController();
  let calls = 0;
  const h = modules({
    fetch: async (url, options) => {
      calls++;
      return abortable(options.signal);
    },
  });
  const pending = h
    .callRequest(
      '',
      { action: 'callSignal' },
      { signal: controller.signal, attempts: 3 },
    )
    .catch((e) => e);
  await until(() => calls === 1);
  controller.abort(new DOMException('Session closed', 'AbortError'));
  const error = await pending;
  assert.equal(error.name, 'AbortError');
  assert.equal(calls, 1);
  assert.equal(h.clock.pending(), 0);
});
test('HTTP pre-aborted session never starts a live request', async () => {
  const controller = new AbortController();
  controller.abort();
  let liveRequests = 0;
  const h = modules({
    fetch: async (url, options) => {
      if (options.signal.aborted) throw options.signal.reason;
      liveRequests++;
      return json();
    },
  });
  await assert.rejects(
    h.callRequest(
      '',
      { action: 'callStart' },
      { signal: controller.signal, attempts: 3 },
    ),
  );
  assert.equal(liveRequests, 0);
  assert.equal(h.clock.pending(), 0);
});
test('HTTP retries HTML 502 without exposing server HTML', async () => {
  let calls = 0;
  const h = modules({
    fetch: async () =>
      ++calls === 1
        ? new Response('<html>private upstream traceback</html>', {
            status: 502,
          })
        : json(),
  });
  await h.callRequest('', { action: 'callStart' }, { attempts: 2 });
  assert.equal(calls, 2);
});
test('REGRESSION: timeout after 200 headers while reading body must remain retryable', async () => {
  const clock = fakeClock();
  let calls = 0;
  const h = modules({
    clock,
    fetch: async (url, options) => {
      if (++calls === 1)
        return { status: 200, ok: true, json: () => abortable(options.signal) };
      return json();
    },
  });
  const pending = h
    .callRequest(
      '',
      { action: 'callAccept', id: 'already-committed' },
      { attempts: 2 },
    )
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  await until(() => calls === 1);
  clock.advance(8500);
  const result = await pending;
  assert.equal(
    result.error,
    undefined,
    'Timeout reading a successful response body must not become terminal HTTP 200',
  );
  assert.equal(calls, 2);
  assert.equal(clock.pending(), 0);
});
test('HTTP external abort while reading body never retries', async () => {
  const controller = new AbortController();
  let calls = 0;
  const h = modules({
    fetch: async (url, options) => {
      calls++;
      return { status: 200, ok: true, json: () => abortable(options.signal) };
    },
  });
  const pending = h
    .callRequest('?action=callState', undefined, {
      signal: controller.signal,
      attempts: 3,
    })
    .catch((e) => e);
  await until(() => calls === 1);
  controller.abort();
  await pending;
  assert.equal(calls, 1);
  assert.equal(h.clock.pending(), 0);
});
test('HTTP removes the external abort listener after success', async () => {
  const controller = new AbortController(),
    signal = controller.signal;
  let added = 0,
    removed = 0;
  const add = signal.addEventListener.bind(signal),
    remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => {
    added++;
    return add(...args);
  };
  signal.removeEventListener = (...args) => {
    removed++;
    return remove(...args);
  };
  const h = modules({ fetch: async () => json() });
  await h.callRequest('?action=callState', undefined, { signal });
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(h.clock.pending(), 0);
});
