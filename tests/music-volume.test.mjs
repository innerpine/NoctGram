import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['lib/music-volume.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const {
  musicGain,
  readMusicVolume,
  youtubeVolume,
  volumeFromYouTube,
  observeMusicVolume,
  SYSTEM_MUSIC_VOLUME_QUERY,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

void test('quiet volume choices have fine gain control, mute is silent and full scale remains available', () => {
  assert.equal(musicGain(0), 0);
  assert.equal(musicGain(1), 0.0001);
  assert.equal(musicGain(10), 0.010000000000000002);
  assert.equal(musicGain(50), 0.25);
  assert.equal(musicGain(100), 1);
  assert.ok(
    musicGain(1) < 0.01 / 50,
    '1% is substantially quieter than the previous linear 1%',
  );
  for (let i = 1; i <= 100; i++) assert.ok(musicGain(i) > musicGain(i - 1));
});
void test('saved quiet levels and mute are retained, malformed storage uses a quieter default', () => {
  for (const [saved, expected] of [
    [null, 25],
    ['', 25],
    ['bad', 25],
    ['Infinity', 25],
    ['0', 0],
    ['1', 1],
    ['7', 7],
    ['150', 100],
    ['-10', 0],
  ])
    assert.equal(readMusicVolume(saved), expected);
});
void test('YouTube native integer limits do not create silent nonzero steps or make the slider jump during polling', () => {
  assert.equal(youtubeVolume(0), 0);
  assert.equal(youtubeVolume(1), 1);
  assert.equal(youtubeVolume(50), 25);
  assert.equal(youtubeVolume(100), 100);
  for (let volume = 0; volume <= 100; volume++) {
    const native = youtubeVolume(volume);
    assert.equal(Number.isInteger(native), true);
    assert.equal(volumeFromYouTube(native, volume), volume);
  }
  assert.equal(volumeFromYouTube(0, 25), 0);
  assert.equal(volumeFromYouTube(25, 10), 50);
});

void test('phone playback uses hardware volume without overwriting the saved desktop level', () => {
  const media = Object.assign(new EventTarget(), { matches: true });
  let saved = '0';
  const changes = [];
  const stop = observeMusicVolume(
    (value, system) => changes.push([value, system]),
    {
      matchMedia(query) {
        assert.equal(query, SYSTEM_MUSIC_VOLUME_QUERY);
        return media;
      },
      localStorage: {
        getItem: () => saved,
        setItem: () =>
          assert.fail(
            'Hardware volume must not overwrite the desktop preference',
          ),
      },
    },
  );
  assert.deepEqual(
    changes,
    [[100, true]],
    'A previously muted website must not mute the phone',
  );
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  assert.deepEqual(changes.at(-1), [0, false]);
  saved = '7';
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.deepEqual(changes.at(-1), [100, true]);
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  assert.deepEqual(changes.at(-1), [7, false]);
  stop();
  const count = changes.length;
  media.dispatchEvent(new Event('change'));
  assert.equal(changes.length, count, 'The listener is removed on cleanup');
});

void test('unavailable device storage does not prevent mobile or desktop playback', () => {
  const media = Object.assign(new EventTarget(), { matches: true });
  const changes = [];
  let reads = 0;
  const stop = observeMusicVolume((value) => changes.push(value), {
    matchMedia: () => media,
    get localStorage() {
      reads++;
      throw new Error('Storage disabled');
    },
  });
  assert.deepEqual(changes, [100]);
  assert.equal(reads, 0);
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  assert.deepEqual(changes, [100, 25]);
  stop();
});
