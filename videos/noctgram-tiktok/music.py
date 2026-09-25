"""Музыка и звуки для TikTok-ролика NoctGram (28 с, 120 BPM, доля = 0.5 с).

Трек пишется кодом под монтаж: склейки сцен стоят на долях, звуки интерфейса
совпадают с касаниями в кадре. Без генеративных моделей.
    python3 music.py assets/music.wav
"""
import sys
import wave

import numpy as np

SR = 44100
DUR = 28.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(3)
mus = np.zeros((N, 2))   # музыка (под сайдчейн)
drm = np.zeros((N, 2))   # ударные
fx = np.zeros((N, 2))    # звуки интерфейса и переходов


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(d):
    return np.arange(int(d * SR)) / SR


def add(buf, t0, sig, gain=1.0, pan=0.0):
    i = int(round(t0 * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    sig = sig[: N - i]
    buf[i:i + len(sig), 0] += sig * gain * np.sqrt((1 - pan) / 2)
    buf[i:i + len(sig), 1] += sig * gain * np.sqrt((1 + pan) / 2)


def band(x, lo, hi):
    s = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    s[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(s, len(x))


def norm(x):
    m = np.max(np.abs(x))
    return x / m if m else x


def noise(d):
    return rng.standard_normal(int(d * SR))


# ---------- инструменты ----------
def pad(notes, d, att=0.6, rel=0.9):
    t = tt(d + rel)
    env = np.minimum(1, t / att) * np.clip((d + rel - t) / rel, 0, 1)
    s = np.zeros_like(t)
    for m in notes:
        f = mtof(m)
        for det in (-0.005, 0.0, 0.005):
            ph = 2 * np.pi * f * (1 + det) * t
            s += np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    return s * env / (3 * len(notes))


def pluck(m, d=0.6, bright=1.0):
    t = tt(d)
    f = mtof(m)
    s = sum((1 / k) * np.sin(2 * np.pi * k * f * t) * np.exp(-t * (6 + k * 5 / bright)) for k in range(1, 9))
    return s * (1 - np.exp(-t * 900))


def bell(m, d=2.0):
    t = tt(d)
    f = mtof(m)
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t * 5)
            + 0.15 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t * 9)) * np.exp(-t * 2.6) * (1 - np.exp(-t * 900))


def sub(m, d):
    t = tt(d)
    f = mtof(m)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * np.minimum(1, t / 0.01) * np.clip((d - t) / 0.08, 0, 1)


def kick():
    t = tt(0.4)
    f = 48 + 110 * np.exp(-t * 32)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8) + 0.15 * norm(band(noise(0.4), 1500, 6000)) * np.exp(-t * 90)


def hat(open_=False):
    d = 0.18 if open_ else 0.05
    t = tt(d)
    return norm(band(noise(d), 7000, 16000)) * np.exp(-t * (18 if open_ else 80))


def clap():
    t = tt(0.3)
    env = sum(np.exp(-np.maximum(0, t - k * 0.011) * 60) * (t >= k * 0.011) for k in range(3))
    return norm(band(noise(0.3), 900, 5000)) * env * np.exp(-t * 9)


def whoosh(d=0.5, lo=300, hi=6000, rise=True):
    t = tt(d)
    env = (t / d) ** 2 if rise else (1 - t / d) ** 2
    return norm(band(noise(d), lo, hi)) * env * np.sin(np.pi * np.minimum(1, t / d)) ** 0.3


def riser(d):
    t = tt(d)
    f = 200 + 1400 * (t / d) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    return (norm(band(noise(d), 800, 9000)) * 0.8 + tone) * (t / d) ** 2.5


def boom():
    t = tt(1.4)
    f = 38 + 60 * np.exp(-t * 12)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.8) + 0.25 * norm(band(noise(1.4), 200, 3000)) * np.exp(-t * 6)


def tap():
    t = tt(0.06)
    return norm(band(noise(0.06), 1800, 7000)) * np.exp(-t * 110) + 0.5 * np.sin(2 * np.pi * 1600 * t) * np.exp(-t * 90)


def pop(m=84):
    t = tt(0.16)
    f = mtof(m) * (1 + 0.6 * np.exp(-t * 40))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 26)


def tick():
    t = tt(0.03)
    return np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 300)


# ---------- гармония ----------
CH = {
    'Am': (45, [57, 60, 64, 71]), 'F': (41, [53, 57, 60, 64]), 'C': (48, [55, 60, 64, 71]),
    'G': (43, [55, 59, 62, 66]), 'Fm7': (41, [53, 57, 60, 63]),
}

# интро 0–6
add(mus, 0.0, pad([57, 60, 64, 71], 3.0, att=1.2), 0.26)
add(mus, 0.0, sub(33, 3.0), 0.18)
for k in range(6):
    add(fx, 0.25 + k * BEAT, tick(), 0.05, -0.4)            # часы «02:14»
add(fx, 0.2, whoosh(0.4, 400, 5000, False), 0.05)
add(fx, 1.6, boom(), 0.35)                                  # «Нам тоже.»
add(mus, 1.6, bell(76, 2.0), 0.12, 0.2)
add(fx, 2.0, riser(1.0), 0.18)
add(fx, 3.0, boom(), 0.55)                                  # знак
add(mus, 3.0, pad([53, 57, 60, 64, 67], 3.0, att=0.8), 0.28)
add(mus, 3.0, sub(29, 3.0), 0.2)
for k in range(18):                                         # искры частиц
    tk = 3.1 + 1.3 * (k / 18) ** 0.8
    add(mus, tk, pluck([88, 91, 93, 95, 96, 100][k % 6], 0.4, 2.0), 0.05, -0.7 + 1.4 * ((k * 5) % 18) / 18)
for m in (65, 69, 72, 76, 79):                              # «bloom» знака
    add(mus, 4.4, bell(m, 2.4), 0.07)
add(fx, 4.72, whoosh(0.35, 1500, 9000, False), 0.07, 0.3)   # слово «noctgram»
add(fx, 5.2, riser(0.8), 0.14)

# грув 6–24: смена аккорда каждый такт (2 с)
prog = [(6, 'Am'), (8, 'F'), (10, 'C'), (12, 'G'), (14, 'Am'), (16, 'F'), (18, 'C'), (20, 'G'), (22, 'Fm7')]
arp_pat = [0, 1, 2, 3, 2, 1, 2, 3]
for t0, name in prog:
    root, tones = CH[name]
    add(mus, t0, pad(tones, 2.0, att=0.25, rel=0.5), 0.22)
    for b in range(4):
        add(mus, t0 + b * BEAT, sub(root, 0.42), 0.34)
    if t0 >= 9:
        for s in range(16):                                 # пульсирующее арпеджио 16-ми
            m = tones[arp_pat[s % 8]] + 12
            add(mus, t0 + s * 0.125, pluck(m, 0.35, 0.8), 0.045 + 0.02 * (s % 4 == 0), -0.5 + (s % 8) / 8)
for b in range(int((24 - 6) / BEAT)):
    t = 6 + b * BEAT
    add(drm, t, kick(), 0.62)
    add(drm, t + 0.25, hat(), 0.07, 0.3)
    if t >= 9 and b % 2 == 1:
        add(drm, t, clap(), 0.16, -0.1)
    if t >= 12 and b % 4 == 3:
        add(drm, t + 0.25, hat(True), 0.05, -0.3)
for i, m in enumerate([69, 72, 76, 79, 81]):                # токены «лента…музыка»
    add(mus, 6.5 + i * BEAT, pluck(m + 12, 0.8, 1.6), 0.16, -0.3 + i * 0.15)
    add(fx, 6.5 + i * BEAT, tick(), 0.05)

# переходы и интерфейс
add(fx, 8.78, whoosh(0.25, 800, 8000), 0.12, -0.4)
add(fx, 9.0, whoosh(0.9, 200, 3000, False), 0.2)            # облако карточек
for i in range(8):
    add(fx, 9.05 + i * 0.07, whoosh(0.3, 1500, 9000, False), 0.03, -0.8 + i * 0.22)
add(fx, 11.3, riser(0.7), 0.15)
add(fx, 12.0, boom(), 0.3)
add(fx, 13.22, tap(), 0.25)                                 # лайк
add(fx, 13.24, pop(86), 0.12)
add(fx, 13.9, tap(), 0.25)                                  # «поддержать»
add(fx, 13.97, whoosh(0.4, 600, 5000, False), 0.08)         # шторка Stars
add(fx, 14.72, tap(), 0.25)                                 # «Отправить»
for i, m in enumerate([84, 88, 91, 96, 100]):               # золотые искры
    add(fx, 14.74 + i * 0.05, bell(m, 1.0), 0.07, -0.5 + i * 0.25)
add(fx, 15.28, whoosh(0.22, 800, 8000), 0.1)
for t0, m in [(15.75, 81), (16.3, 86), (17.15, 81), (17.5, 86)]:  # сообщения
    add(fx, t0, pop(m), 0.13, -0.3 if m == 81 else 0.3)
for k in range(6):
    add(fx, 16.7 + k * 0.08, tick(), 0.025)                 # «печатает»
add(fx, 17.75, pop(93), 0.06)                               # прочитано
for k, t0 in enumerate([18.05, 18.35]):                     # звонок
    add(fx, t0, bell(79 + k * 5, 0.6), 0.09)
add(fx, 18.8, whoosh(0.22, 800, 8000), 0.1, -0.4)
add(fx, 19.0, whoosh(0.6, 300, 4000, False), 0.1, 0.4)
add(fx, 20.78, whoosh(0.22, 800, 9000), 0.1)
for m in (84, 88, 91):                                      # Premium
    add(fx, 21.45, bell(m, 1.6), 0.07)
for i in range(3):                                          # подарки
    add(fx, 21.55 + i * 0.12, whoosh(0.25, 1500, 9000, False), 0.05)
    add(fx, 21.6 + i * 0.12, pop(88 + i * 3), 0.05)
add(fx, 22.55, whoosh(0.4, 500, 5000, False), 0.07)         # канал
add(fx, 23.3, tap(), 0.2)                                   # подписаться
add(fx, 23.2, riser(0.8), 0.14)

# финал 24–28
add(mus, 24.0, pad([48, 55, 60, 64, 71], 3.6, att=0.4, rel=0.6), 0.3)
add(mus, 24.0, sub(36, 3.0), 0.2)
add(fx, 24.0, boom(), 0.35)
for t0, m in [(24.12, 60), (24.32, 67), (24.52, 64)]:       # «Ночью / не / одиноко.»
    add(mus, t0, pluck(m, 1.6, 0.5), 0.18)
add(fx, 25.7, whoosh(0.35, 800, 8000), 0.08)
for m in (72, 76, 79, 83, 88):                              # локап
    add(mus, 26.0, bell(m, 2.0), 0.08)
add(fx, 26.0, boom(), 0.3)
add(fx, 26.3, whoosh(0.35, 1500, 9000, False), 0.06)

# ---------- сведение ----------
t = np.arange(N) / SR
duck = np.ones(N)
g = (t >= 6) & (t < 24)
duck[g] = 1 - 0.5 * np.exp(-((t[g] - 6) % BEAT) / 0.11)    # сайдчейн под бочку


def reverb(x, seconds=2.2, wet=0.25):
    n = int(seconds * SR)
    tr = np.arange(n) / SR
    out = x.copy()
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-tr * 3.4)
        ir /= np.sqrt(np.sum(ir ** 2))
        size = 1 << int(np.ceil(np.log2(len(x) + n)))
        out[:, ch] += wet * np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[: len(x)]
    return out


mix = reverb(mus * duck[:, None], wet=0.3) + reverb(drm, 1.0, 0.08) + reverb(fx, 1.6, 0.18)
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.6) * 0.9
mix *= np.interp(t, [0, 0.05, 27.0, 28.0], [0, 1, 1, 0])[:, None]

out = sys.argv[1] if len(sys.argv) > 1 else 'assets/music.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', out)
