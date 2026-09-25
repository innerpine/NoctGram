"""Музыка и звуки для мультфильма «Кто-нибудь не спит?».

Всё синтезируется с нуля (numpy), тайминги совпадают с cartoon.js.
    python3 promo/cartoon/music.py out.wav
"""
import sys
import wave

import numpy as np

SR = 44100
DUR = 62.0
N = int(SR * DUR)
rng = np.random.default_rng(7)

music = np.zeros((N, 2))
sfx = np.zeros((N, 2))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(buf, t0, sig, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    left, right = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    buf[i:i + len(sig), 0] += sig * gain * left
    buf[i:i + len(sig), 1] += sig * gain * right


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def band(x, lo, hi):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(spec, len(x))


def norm(x):
    m = np.max(np.abs(x))
    return x / m if m > 0 else x


# ---------- инструменты ----------
def musicbox(m, dur=2.2):
    t = tt(dur)
    f = mtof(m)
    env = np.exp(-t * 2.6) * (1 - np.exp(-t * 400))
    s = (np.sin(2 * np.pi * f * t)
         + .35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 4)
         + .12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t * 7)
         + .06 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t * 11))
    return s * env


def pad(notes, dur):
    t = tt(dur + 1.2)
    env = np.minimum(1, t / .9) * np.clip((dur + 1.2 - t) / 1.2, 0, 1)
    s = np.zeros_like(t)
    for m in notes:
        f = mtof(m)
        for det in (-.004, .004):
            s += np.sin(2 * np.pi * f * (1 + det) * t) + .25 * np.sin(2 * np.pi * 2 * f * (1 + det) * t)
    return s * env * (1 + .08 * np.sin(2 * np.pi * .3 * t)) / len(notes)


def bass(m, dur):
    t = tt(dur)
    f = mtof(m)
    return (np.sin(2 * np.pi * f * t) + .2 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t * 1.4) * (1 - np.exp(-t * 200))


def kick():
    t = tt(.35)
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def hat():
    t = tt(.08)
    return band(rng.standard_normal(len(t)), 6000, 16000) * np.exp(-t * 60)


def bell(m, dur=1.8):
    t = tt(dur)
    f = mtof(m)
    return (np.sin(2 * np.pi * f * t) + .4 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t * 6)) * np.exp(-t * 3.5) * (1 - np.exp(-t * 800))


# ---------- звуки ----------
def noise(dur):
    return rng.standard_normal(int(dur * SR))


def whoosh(dur=.6, lo=300, hi=3500):
    t = tt(dur)
    env = np.sin(np.pi * t / dur) ** 2
    return norm(band(noise(dur), lo, hi)) * env


def scribble(dur):
    t = tt(dur)
    strokes = np.abs(np.sin(2 * np.pi * (5 + 2 * np.sin(2 * np.pi * .7 * t)) * t)) ** 1.5
    return norm(band(noise(dur), 2500, 8000)) * strokes * np.minimum(1, t / .05) * np.minimum(1, (dur - t) / .05)


def crinkle(dur, density=60):
    n = int(dur * SR)
    imp = np.zeros(n)
    k = rng.integers(0, n, int(density * dur))
    imp[k] = rng.uniform(.3, 1, len(k))
    decay = np.exp(-np.arange(int(.006 * SR)) / (.0015 * SR))
    return norm(band(np.convolve(imp * noise(dur), decay)[:n], 1200, 9000))


def thud(f=80, dur=.25):
    t = tt(dur)
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 18) + .3 * norm(band(noise(dur), 100, 1200)) * np.exp(-t * 40)


def tap():
    t = tt(.05)
    return norm(band(noise(.05), 1500, 6000)) * np.exp(-t * 120)


def plop():
    t = tt(.5)
    f = 150 + 500 * np.exp(-t * 25)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 12) + .5 * norm(band(noise(.5), 800, 5000)) * np.exp(-t * 9)


def buzz(dur=.3):
    t = tt(dur)
    s = np.sign(np.sin(2 * np.pi * 155 * t))
    return band(s, 80, 900) * np.minimum(1, t / .02) * np.minimum(1, (dur - t) / .02)


def blip(m=84):
    t = tt(.18)
    f = mtof(m) * (1 + .5 * np.minimum(1, t / .05))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22)


def ping(t0, gain=.5):
    add(sfx, t0, bell(88, 1.2), gain, .1)
    add(sfx, t0 + .11, bell(95, 1.4), gain * .9, .1)


# ---------- музыка ----------
CHORDS = {
    'Am': (45, [57, 60, 64]), 'F': (41, [53, 57, 60]), 'C': (48, [55, 60, 64]),
    'G': (43, [55, 59, 62]), 'E': (40, [52, 56, 59]), 'Dm': (50, [53, 57, 62]),
}
PROG = [(0, 'Am'), (3, 'F'), (6, 'C'), (9, 'G'), (12, 'Am'), (15, 'F'), (18, 'C'), (21, 'E'),
        (24, 'Am'), (27, 'F'), (30, 'C'), (33, 'G'), (36, 'E'), (38, 'F'), (41, 'C'), (44, 'Am'),
        (47, 'G'), (50, 'F'), (52, 'C'), (54.2, 'F'), (56, 'G'), (58.4, 'C'), (62, None)]

for (t0, name), (t1, _) in zip(PROG, PROG[1:]):
    root, tones = CHORDS[name]
    dur = t1 - t0
    add(music, t0, pad(tones, dur), .16)
    step = .75 if t0 < 38 else .375
    pattern = [tones[0] + 12, tones[1] + 12, tones[2] + 12, tones[1] + 12, tones[2] + 12, tones[0] + 24]
    k, t = 0, t0
    while t < t1 - .05:
        m = pattern[k % len(pattern)]
        vel = .22 if t0 < 24 else .26
        if t0 >= 38:
            vel = .2 if k % 2 else .26
        add(music, t, musicbox(m), vel, -.3 + .6 * ((k * 37) % 10) / 10)
        k += 1
        t += step
    if t0 >= 38:
        b = t0
        while b < t1 - .05:
            add(music, b, bass(root, 1.5), .32)
            b += 1.5

# финальная фраза шкатулки
for i, m in enumerate([72, 76, 79, 84, 88]):
    add(music, 58.45 + i * .18, musicbox(m, 3), .3, -.4 + i * .2)

# лоуфай-ритм во время звонка
b = 44.0
while b < 52.0:
    add(music, b, kick(), .45)
    add(music, b + .75, hat(), .08, .3)
    add(music, b + 1.125, hat(), .05, -.3)
    b += 1.5

# ---------- звуки по сценам ----------
for i in range(9):
    add(sfx, .25 + i * .4, thud(95, .12), .08, -.2)          # шаги Лёвы
add(sfx, 3.3, thud(70, .3), .5)                             # толчок
for i in range(4):
    add(sfx, 3.4 + i * .45, whoosh(.35, 1500, 6000), .06, .2)  # лист планирует
add(sfx, 5.25, tap(), .12)
for i, st in enumerate([6.35, 6.57, 6.79, 7.01, 7.23, 7.45]):
    add(sfx, st, thud(110, .1), .1, -.6 + i * .25)          # чужие шаги
add(sfx, 7.55, crinkle(.35, 40), .12)
for a, b_ in [(16.2, 17.5), (17.6, 18.6), (52.1, 52.8), (52.85, 53.35)]:
    add(sfx, a, scribble(b_ - a), .09)
add(sfx, 19.4, crinkle(.4, 400), .2)                        # лист отрывается
for st in (19.85, 20.1, 20.35, 53.87, 54.0):
    add(sfx, st, crinkle(.18, 120), .12)
add(sfx, 20.6, whoosh(.45), .22)
add(sfx, 21.25, whoosh(.6), .22, .3)                        # бросок
add(sfx, 22.3, whoosh(.9, 200, 1500), .12, .5)              # самолётик падает
add(sfx, 23.08, plop(), .4, .5)                             # в лужу
for a in (24.5, 25.1, 25.7):
    add(sfx, a, buzz(), .12)
ping(24.75, .35)
add(sfx, 29.25, norm(band(noise(.8), 400, 9000)) * np.sin(np.pi * tt(.8) / .8) ** 2 * np.linspace(0, 1, int(.8 * SR)), .1)
for i in range(31):
    add(sfx, 30.35 + i * 1.25 / 31, tap(), .05, .2)          # набор текста
add(sfx, 33.05, tap(), .15)
add(sfx, 33.3, blip(79), .15)
add(sfx, 36.3, tap(), .15)
ping(38.0, .45)
for a, m in [(38.25, 84), (39.1, 86), (39.7, 88)]:
    add(sfx, a, blip(m), .14)
ping(39.45, .4)
r = np.random.default_rng(3)
for i in range(10):
    add(sfx, 41.5 + r.uniform(0, 2.4), bell(int(r.choice([84, 86, 88, 91, 93, 96])), 1.2), .07, r.uniform(-.7, .7))
add(sfx, 46.0, whoosh(.35, 800, 5000), .1)
for i in range(3):
    add(sfx, 46.6 + i * .25, blip(84 + i * 2), .08)
ping(47.0, .3)
scale = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96]
for i in range(14):
    add(sfx, 48.4 + i * 1.9 / 14, bell(scale[i % len(scale)], 1.0), .07, -.8 + 1.6 * (i * 7 % 14) / 14)
for m in (60, 64, 67, 72):
    add(sfx, 50.4, bell(m, 3), .12)
for i in range(6):
    add(sfx, 50.8 + i * .18, bell(91 + (i % 3) * 2, .8), .05, -.5 + i * .2)
add(sfx, 54.55, whoosh(.6), .22, .3)
for i, st in enumerate([55.0, 55.3, 55.5, 55.7, 55.9, 56.1, 56.3]):
    add(sfx, st, whoosh(.7, 400, 4000), .07, -.8 + i * .26)
for i in range(16):
    add(sfx, 57.7 + i * .045, bell(84 + (i * 2) % 17, 1.5), .05, -.8 + i * .1)
for m in (72, 76, 79, 84):
    add(sfx, 59.9, bell(m, 2.5), .1)


# ---------- сведение ----------
def reverb(x, seconds=2.4, wet=.22):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 3.2)
        ir /= np.sqrt(np.sum(ir ** 2))
        size = 1 << int(np.ceil(np.log2(len(x) + n)))
        y = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[:len(x)]
        out[:, ch] = x[:, ch] + wet * y
    return out


t = np.arange(N) / SR
dyn = np.interp(t, [0, .8, 20, 23.5, 24.5, 37.8, 38.2, 61.0, 62], [0, .85, .85, .6, .8, .75, 1, 1, 0])
mix = reverb(music * dyn[:, None], wet=.3) + reverb(sfx, 1.6, .15)
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.4) * .89
fade = np.interp(t, [0, .3, 61.2, 62], [0, 1, 1, 0])
mix *= fade[:, None]

out = sys.argv[1] if len(sys.argv) > 1 else 'cartoon.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', out)
