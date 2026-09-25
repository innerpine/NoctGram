# NoctGram — промо для TikTok (9:16)

Ролик на 28 с, 1080×1920, 30 fps, собран на [HyperFrames](https://github.com/heygen-com/hyperframes): каждая сцена — HTML-композиция с GSAP-таймлайном, рендер покадровый и детерминированный.
Бриф — `BRIEF.md`, раскадровка — `STORYBOARD.md`, дизайн для видео — `design.md` (выведен из `DESIGN.md` приложения).

Сцены (`compositions/`): хук «Не спится? / Нам тоже.» → логотип из частиц → «Всё, что нужно ночью: [лента/истории/чаты/звонки/музыка]» → 3D-облако интерфейса → лента и Noct Stars → сообщения и звонок → музыка → Premium, подарки (настоящие Lottie из приложения) и каналы → «Ночью не одиноко.» и локап.

## Собрать

Нужны Node 22, Python 3 с numpy, ffmpeg и ffprobe в PATH.

```
cd videos/noctgram-tiktok
python3 music.py assets/music.wav          # музыка и звуки, 120 BPM, под монтаж
npx hyperframes check                      # линт, раскладка, контраст
npx hyperframes render --fps 30 -o renders/noctgram-tiktok.mp4
```

Предпросмотр со скрабом по таймлайну: `npx hyperframes preview`.
GSAP и lottie-web лежат в `assets/` локально, чтобы рендер не зависел от CDN.
