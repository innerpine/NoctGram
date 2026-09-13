import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Invoke the real UI callbacks with isolated hooks, storage and requests.
// These tests neither post messages nor debit a real account.
let active;
const mounted = [],
  cleanups = [];
globalThis.__giveawayHooks = {
  useState(initial) {
    const owner = active,
      index = owner.cursor++;
    if (owner.first)
      owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [
      owner.slots[index],
      (value) => {
        owner.slots[index] =
          typeof value === 'function' ? value(owner.slots[index]) : value;
      },
    ];
  },
  useRef(initial) {
    const owner = active,
      index = owner.cursor++;
    if (owner.first) owner.slots[index] = { current: initial };
    return owner.slots[index];
  },
  useId() {
    return 'fixture-' + active.cursor++;
  },
  useEffect(effect) {
    active.cursor++;
    if (active.first) active.effects.push(effect);
  },
};
const { outputFiles } = await build({
  stdin: {
    contents: `export * from './app/giveaway-card'; export * from './app/giveaway-create';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  plugins: [
    {
      name: 'giveaway-ui-fixtures',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/ui\/(?:dialog|radio-group)|@\/lib\/giveaways-client|\.\/(?:stars-icon|premium-icon|profile-link|profile-identity))$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'react'
              ? 'export const {useState,useRef,useEffect,useId}=globalThis.__giveawayHooks;'
              : path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx; export const Fragment="Fragment";'
                : path.includes('giveaways-client')
                  ? 'export const giveawayRequest=(...args)=>globalThis.__giveawayRead(...args),createGiveaway=(...args)=>globalThis.__giveawayCreate(...args);'
                  : path.includes('radio-group')
                    ? 'export const RadioGroup="RadioGroup",RadioGroupItem="RadioGroupItem";'
                    : path.includes('/dialog')
                      ? 'export const Dialog="Dialog",DialogContent="DialogContent",DialogTitle="DialogTitle",DialogDescription="DialogDescription";'
                      : path.includes('stars-icon')
                        ? 'export const StarsIcon="StarsIcon";'
                        : path.includes('premium-icon')
                          ? 'export const PremiumIcon="PremiumIcon";'
                          : path.includes('profile-link')
                            ? 'export const ProfileLink="ProfileLink";'
                            : path.includes('profile-identity')
                              ? 'export const Avatar="Avatar";'
                              : 'export const Check="Check",Clock3="Clock3",Gift="Gift",LoaderCircle="LoaderCircle",Trophy="Trophy",Users="Users";',
        }));
      },
    },
  ],
});
const api = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const savedGlobals = new Map(
  [
    'window',
    'document',
    'sessionStorage',
    'fetch',
    'setInterval',
    'clearInterval',
  ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
);
const savedNow = Date.now;
let now = savedNow(),
  wallet = 10000;
Date.now = () => now;
const localStorage = new Map(),
  timers = new Map(),
  calls = [],
  reads = [];
let timerId = 0,
  displayed;
const windowEvents = new EventTarget(),
  documentEvents = new EventTarget();
documentEvents.hidden = false;
let giftsChanged = 0;
windowEvents.addEventListener('noctgram:gifts-changed', () => giftsChanged++);
const replace = (name, value) =>
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
replace('window', windowEvents);
replace('document', documentEvents);
replace('sessionStorage', {
  getItem: (key) => localStorage.get(key) ?? null,
  setItem: (key, value) => localStorage.set(key, value),
  removeItem: (key) => localStorage.delete(key),
});
replace('setInterval', (callback) => {
  timers.set(++timerId, callback);
  return timerId;
});
replace('clearInterval', (id) => timers.delete(id));
replace('fetch', async (url) => {
  assert.equal(
    url,
    '/api/gifts?action=catalog',
    'Only the mocked wallet is read',
  );
  return Response.json({ balance: wallet });
});
globalThis.__giveawayRead = async (...args) => {
  reads.push(args);
  return { giveaway: structuredClone(displayed) };
};
globalThis.__giveawayCreate = (...args) =>
  new Promise((resolve, reject) => {
    calls.push({ args: structuredClone(args), resolve, reject });
  });
const flush = async () => {
  for (let index = 0; index < 4; index++)
    await new Promise((resolve) => setImmediate(resolve));
};
const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];
const words = (tree) =>
  tree === null || tree === undefined || typeof tree === 'boolean'
    ? ''
    : Array.isArray(tree)
      ? tree.map(words).join('')
      : typeof tree === 'object'
        ? words(tree.props?.children)
        : String(tree);
function mount(component, props) {
  const owner = {
    first: true,
    cursor: 0,
    slots: [],
    effects: [],
    disposed: false,
    props,
  };
  owner.render = () => {
    active = owner;
    owner.cursor = 0;
    const tree = component(owner.props);
    if (owner.first) {
      owner.first = false;
      owner.cleanups = owner.effects.map((effect) => effect());
    }
    return tree;
  };
  owner.find = (predicate) => nodes(owner.render()).find(predicate);
  owner.text = () => words(owner.render());
  owner.dispose = () => {
    if (owner.disposed) return;
    owner.disposed = true;
    owner.cleanups.forEach((cleanup) => cleanup?.());
  };
  owner.render();
  mounted.push(owner);
  return owner;
}
function form(targetId = 'room:test', actorId = 'organizer') {
  let finished = 0;
  const button = mount(api.GiveawayCreateButton, {
    targetKind: 'group',
    targetId,
    targetName: 'Noctgram | Общение',
    actorId,
    onCreated: () => finished++,
  });
  button.find((node) => node.type === 'button').props.onClick();
  const element = button.find((node) => typeof node.type === 'function');
  assert.ok(element, 'Opening the dialog mounts the real form');
  const owner = mount(element.type, element.props);
  owner.submit = () =>
    owner
      .find((node) => node.type === 'form')
      .props.onSubmit({ preventDefault() {} });
  owner.submitButton = () =>
    owner.find((node) => node.type === 'button' && node.props.type === 'submit')
      .props;
  owner.finished = () => finished;
  return owner;
}
const base = {
  id: 'giveaway:fixture',
  targetKind: 'channel',
  targetId: 'channel:test',
  creator: 'organizer',
  prize: 'stars',
  winnerCount: 3,
  starsPerWinner: 100,
  premiumDays: 30,
  totalCost: 300,
  created: now,
  endsAt: now + 3600000,
  status: 'active',
  completedAt: 0,
  participantCount: 7,
  participating: true,
  winners: [],
  refund: 0,
};
try {
  displayed = base;
  const activeCard = mount(api.GiveawayCard, {
    id: base.id,
    viewerId: 'viewer',
  });
  await flush();
  assert.match(activeCard.text(), /Ты участвуешь/);
  assert.match(activeCard.text(), /Подписчики канала участвуют автоматически/);
  assert.match(activeCard.text(), /Организатор не участвует/);
  assert.match(activeCard.text(), /Участников сейчас: 7/);
  assert.equal(activeCard.find((n) => n.type === 'StarsIcon').props.size, 64);
  assert.equal(api.remainingTime(now - 1, now), 'Подводим итоги');
  activeCard.dispose();

  displayed = { ...base, participating: false };
  const unsubscribed = mount(api.GiveawayCard, {
    id: base.id,
    viewerId: 'viewer',
  });
  await flush();
  assert.match(unsubscribed.text(), /Подпишись на канал, чтобы участвовать/);
  unsubscribed.dispose();
  displayed = {
    ...base,
    prize: 'premium',
    targetKind: 'group',
    participating: false,
  };
  const organizer = mount(api.GiveawayCard, {
    id: base.id,
    viewerId: 'organizer',
  });
  await flush();
  assert.match(organizer.text(), /Ты организатор/);
  assert.match(organizer.text(), /Участники группы участвуют автоматически/);
  assert.match(organizer.text(), /30 дней/);
  assert.ok(organizer.find((n) => n.type === 'PremiumIcon'));
  organizer.dispose();

  displayed = {
    ...base,
    status: 'completed',
    completedAt: now,
    winners: [
      { id: 'winner:a', name: 'Seedy', avatar: '', handle: 'root' },
      { id: 'winner:b', name: 'Друг', avatar: '', handle: 'friend' },
    ],
    refund: 100,
  };
  const completed = mount(api.GiveawayCard, {
    id: base.id,
    viewerId: 'winner:a',
  });
  await flush();
  assert.match(completed.text(), /Итоги розыгрыша/);
  assert.match(completed.text(), /Ты выиграл! Приз уже зачислен/);
  assert.match(completed.text(), /100 Noct Stars возвращено организатору/);
  assert.deepEqual(
    nodes(completed.render())
      .filter((n) => n.type === 'ProfileLink')
      .map((n) => n.props.target),
    [{ id: 'winner:a' }, { id: 'winner:b' }],
  );
  const readsBefore = reads.length;
  for (const tick of timers.values()) tick();
  await flush();
  assert.equal(
    reads.length,
    readsBefore,
    'Completed results stop repeated network reads',
  );
  completed.dispose();

  displayed = {
    ...base,
    status: 'completed',
    completedAt: now,
    winners: [],
    refund: 300,
  };
  const empty = mount(api.GiveawayCard, { id: base.id, viewerId: 'organizer' });
  await flush();
  assert.match(empty.text(), /Нет подходящих участников/);
  assert.match(empty.text(), /300 Noct Stars возвращено организатору/);
  assert.ok(!empty.find((n) => n.type === 'ProfileLink'));
  empty.dispose();
  const signedOut = mount(api.GiveawayCard, { id: base.id });
  await flush();
  assert.match(signedOut.text(), /Войди в Noctgram/);
  assert.equal(
    reads.length,
    readsBefore + 1,
    'Signed-out viewer does not request restricted details',
  );
  signedOut.dispose();

  const premium = form();
  await flush();
  premium.find((n) => n.type === 'RadioGroup').props.onValueChange('premium');
  premium
    .find((n) => n.type === 'input' && n.props.id.endsWith('-count'))
    .props.onChange({ target: { value: '2' } });
  assert.match(premium.text(), /30 дней · 500(?: Noct)? Stars/);
  assert.match(
    premium.text(),
    /1\s000/,
    'Two Premium prizes cost 1000 internal Stars',
  );
  assert.ok(
    !premium.find((n) => n.type === 'input' && n.props.id.endsWith('-stars')),
    'Premium uses fixed server price',
  );
  assert.equal(premium.submitButton().disabled, false);
  premium.submit();
  premium.submit();
  assert.equal(calls.length, 1, 'Fast repeated submit creates one request');
  const originalDraft = calls[0].args[0];
  assert.equal(
    originalDraft.actor,
    'organizer',
    'Debit is bound to the account shown in the form',
  );
  assert.equal(originalDraft.prize, 'premium');
  assert.equal(originalDraft.winnerCount, 2);
  assert.equal(originalDraft.starsPerWinner, 0);
  assert.equal(originalDraft.targetId, 'room:test');
  assert.match(originalDraft.key, /^[0-9a-f-]{36}$/i);
  calls[0].reject(new Error('Связь потеряна'));
  await flush();
  assert.match(premium.text(), /Повторное нажатие не спишет звёзды ещё раз/);
  assert.equal(premium.find((n) => n.type === 'fieldset').props.disabled, true);
  assert.equal(
    premium.submitButton().disabled,
    false,
    'Uncertain outcome can be checked safely',
  );
  assert.equal(localStorage.size, 1);
  premium.dispose();

  const otherActorKey = 'noctgram:giveaway-draft:another:group:room:test';
  localStorage.set(otherActorKey, JSON.stringify(originalDraft));
  const otherActor = form('room:test', 'another');
  await flush();
  assert.equal(
    otherActor.find((n) => n.type === 'fieldset').props.disabled,
    false,
    'A draft from another account is not restored even if stored under this account key',
  );
  assert.equal(
    otherActor.find((n) => n.type === 'RadioGroup').props.value,
    'stars',
  );
  otherActor.dispose();
  localStorage.delete(otherActorKey);

  now += 2 * 86400000;
  wallet = 0;
  const resumed = form();
  await flush();
  assert.equal(
    resumed.submitButton().disabled,
    false,
    'Restored pending request can be retried despite elapsed deadline and changed balance',
  );
  resumed.submit();
  assert.deepEqual(
    calls[1].args[0],
    originalDraft,
    'Reopening the dialog reuses the complete immutable request',
  );
  calls[1].reject(
    Object.assign(new Error('Временная ошибка'), { status: 500 }),
  );
  await flush();
  resumed.submit();
  assert.deepEqual(
    calls[2].args[0],
    originalDraft,
    'Server 5xx retries keep the same key and prize payload',
  );
  for (const status of [400, 401, 403, 404, 409, 429]) {
    calls
      .at(-1)
      .reject(
        Object.assign(new Error('Исход пока не подтверждён'), { status }),
      );
    await flush();
    assert.equal(
      resumed.find((n) => n.type === 'fieldset').props.disabled,
      true,
      `HTTP ${status} alone cannot prove that a debit did not commit`,
    );
    resumed.submit();
    assert.deepEqual(
      calls.at(-1).args[0],
      originalDraft,
      'Only explicit precommit rejection can discard the original payment key',
    );
  }
  calls.at(-1).resolve({ giveaway: base, balance: 8000 });
  await flush();
  assert.equal(localStorage.size, 0, 'Confirmed outcome clears saved request');
  assert.equal(resumed.finished(), 1);
  assert.equal(
    giftsChanged,
    1,
    'Successful creation refreshes wallet displays',
  );
  resumed.dispose();

  wallet = 10000;
  const invalid = form('room:other');
  await flush();
  invalid.submit();
  const index = calls.length - 1;
  calls[index].reject(
    Object.assign(new Error('Проверь данные'), {
      status: 400,
      code: 'GIVEAWAY_REJECTED',
    }),
  );
  await flush();
  assert.equal(localStorage.size, 0, 'Definitive rejection unlocks editing');
  assert.equal(
    invalid.find((n) => n.type === 'fieldset').props.disabled,
    false,
  );
  assert.match(invalid.text(), /Проверь данные/);
  invalid.dispose();
  console.log(
    'Giveaway UI: eligibility, winner links, refunds, 500-Star Premium cost, double-submit lock and persisted retries passed.',
  );
} finally {
  mounted.forEach((owner) => owner.dispose());
  cleanups.forEach((cleanup) => cleanup());
  Date.now = savedNow;
  for (const [name, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  delete globalThis.__giveawayHooks;
  delete globalThis.__giveawayRead;
  delete globalThis.__giveawayCreate;
}
