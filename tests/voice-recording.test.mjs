import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Pure parts of voice and round video recording: the Telegram waveform
// layout, player bar sizing and the recorder format choice per browser.
const { outputFiles } = await build({
  entryPoints: ['lib/voice-waveform.ts', 'lib/media-recorder.ts'],
  bundle: true,
  write: false,
  outdir: 'unused',
  platform: 'node',
  format: 'esm',
});
const [waveform, recorder] = await Promise.all(
  outputFiles.map(
    (file) =>
      import(
        'data:text/javascript;base64,' + Buffer.from(file.text).toString('base64')
      ),
  ),
);
const {
  encodeWaveform,
  decodeWaveform,
  waveformFromPeaks,
  resampleWaveform,
  waveformBarCount,
  formatRecordingTime,
} = waveform;

// Five-bit samples round-trip through the stored alphabet.
const values = Array.from({ length: 32 }, (_, i) => i);
assert.equal(encodeWaveform(values), '0123456789abcdefghijklmnopqrstuv');
assert.deepEqual(decodeWaveform('0123456789abcdefghijklmnopqrstuv'), values);
assert.equal(encodeWaveform([-4, 40, 7.6, Number.NaN]), '0v80');
assert.deepEqual(decodeWaveform('0z!v'), [0, 31], 'Unknown characters are skipped');
assert.equal(encodeWaveform(Array(150).fill(5)).length, 100);
assert.match(encodeWaveform(Array(150).fill(5)), /^[0-9a-v]{0,100}$/);

// Peaks become 100 samples; silence stays flat and outliers are capped.
assert.deepEqual(waveformFromPeaks([]), []);
const silence = waveformFromPeaks(Array(300).fill(0));
assert.equal(silence.length, 100);
assert.ok(silence.every((value) => value === 0));
const speech = waveformFromPeaks(
  Array.from({ length: 400 }, (_, i) => (i % 40 < 20 ? 12000 : 800)),
);
assert.equal(speech.length, 100);
assert.ok(speech.every((value) => value >= 0 && value <= 31));
assert.equal(Math.max(...speech), 31);
assert.ok(Math.min(...speech) < 10);
const spike = waveformFromPeaks([...Array(99).fill(3000), 32767]);
assert.equal(spike.at(-1), 31, 'A single spike cannot flatten the rest');
assert.ok(spike[0] > 5);
assert.equal(waveformFromPeaks([9000, 20000]).length, 100, 'Short recordings stretch');

// Player bars keep the loudest sample of each span.
assert.deepEqual(resampleWaveform([1, 9, 2, 3], 2), [9, 3]);
assert.deepEqual(resampleWaveform([], 3), [0, 0, 0]);
assert.equal(resampleWaveform(decodeWaveform('abc'), 10).length, 10);
assert.equal(waveformBarCount(1000), 24);
assert.equal(waveformBarCount(20000), 50);
assert.equal(waveformBarCount(3600000), 56);
assert.equal(formatRecordingTime(7400, true), '0:07,4');
assert.equal(formatRecordingTime(61000), '1:01');

// Recorder formats: MP4 plays everywhere, then WebM/Opus, then Ogg/Opus.
const { pickRecorderType, recordingExtension, recordingError } = recorder;
const chrome = new Set(['audio/webm;codecs=opus', 'audio/webm', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
const safari = new Set(['audio/mp4', 'video/mp4']);
const firefox = new Set(['audio/ogg;codecs=opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
assert.equal(pickRecorderType('voice', (type) => chrome.has(type)), 'audio/webm;codecs=opus');
assert.equal(pickRecorderType('round', (type) => chrome.has(type)), 'video/webm;codecs=vp9,opus');
assert.equal(pickRecorderType('voice', (type) => safari.has(type)), 'audio/mp4');
assert.equal(pickRecorderType('round', (type) => safari.has(type)), 'video/mp4');
assert.equal(pickRecorderType('voice', (type) => firefox.has(type)), 'audio/ogg;codecs=opus');
assert.equal(pickRecorderType('round', (type) => firefox.has(type)), 'video/webm;codecs=vp8,opus');
assert.equal(pickRecorderType('voice', () => false), '', 'The browser default is used');
assert.equal(recordingExtension('audio/webm;codecs=opus'), 'webm');
assert.equal(recordingExtension('audio/ogg'), 'ogg');
assert.equal(recordingExtension('audio/mp4'), 'm4a');
assert.equal(recordingExtension('video/mp4;codecs=avc1'), 'mp4');
assert.equal(recordingExtension('video/webm'), 'webm');

// Permission errors are explained in Russian.
assert.match(
  recordingError(new DOMException('denied', 'NotAllowedError'), 'voice'),
  /микрофону/,
);
assert.match(
  recordingError(new DOMException('missing', 'NotFoundError'), 'round'),
  /Камера или микрофон/,
);
assert.match(
  recordingError(new DOMException('busy', 'NotReadableError'), 'voice'),
  /занято/,
);
