---
format: 1080x1920
duration: 28s
message: "NoctGram — место, где ночью не одиноко"
arc: Hook → Brand → Breadth → Features (лента+Stars, чаты+звонки, музыка, Premium+подарки+каналы) → Tagline → Lockup
audience: русскоязычные зумеры в TikTok, которые сидят в телефоне ночью
mode: autonomous
music: minimal night electronica, 120 BPM, written in code
---

## Frame 1 — Не спится?

- scene: «Не спится?» проявляется из размытия, склейка-вытеснение → «Нам тоже.»
- duration: 3s
- transition_in: cut
- status: animated
- src: compositions/f1-hook.html
- blueprint: kinetic-type-beats (rules: dynamic-content-sequencing, discrete-text-sequence)

Холодное открытие. Моно-время «02:14» в углу. Удержание — тишина.

## Frame 2 — Знак

- scene: частицы из глубины собираются в луну-логотип, раскрывается «noctgram»
- duration: 3s
- transition_in: cut
- status: animated
- src: compositions/f2-logo.html
- blueprint: logo-assemble-lockup (rules: depth-scatter-assemble, ambient-glow-bloom)

## Frame 3 — Всё, что нужно

- scene: фиксированная строка «Всё, что нужно ночью:», токен в сиреневой плашке меняется по бите
- duration: 3s
- transition_in: zoom-through
- status: animated
- src: compositions/f3-tokens.html
- blueprint: kinetic-type-beats / in-place token cycle (rules: discrete-text-sequence)

## Frame 4 — В одном месте

- scene: карточки интерфейса вылетают из глубины вокруг «в одном месте», глубина резкости
- duration: 3s
- transition_in: cut-the-curve
- status: animated
- src: compositions/f4-cloud.html
- blueprint: constellation-hub scatter-drift end card (rules: depth-scatter-assemble, depth-of-field-blur)

## Frame 5 — Лента и Stars

- scene: пост выезжает с наклоном, касание по сердцу, затем «Поддержать ★ 50» и золотые искры
- duration: 3.5s
- transition_in: zoom-through
- status: animated
- src: compositions/f5-feed.html
- blueprint: cursor-ui-demo (rules: cursor-click-ripple, press-release-spring, vertical-spring-ticker, particle-burst)

## Frame 6 — Сообщения и звонки

- scene: переписка собирается по сообщению, «печатает…», отметка прочтения, плашка звонка
- duration: 3.5s
- transition_in: cut-the-curve
- status: animated
- src: compositions/f6-chat.html
- blueprint: agent-progress-theater conversation variant (rules: dynamic-content-sequencing)

## Frame 7 — Музыка

- scene: плеер разворачивается в 3D, эквалайзер в такт, «слушают вместе»
- duration: 2s
- transition_in: cut-the-curve
- status: animated
- src: compositions/f7-music.html
- blueprint: device-surface-showcase floating window (rules: split-tilt-cards, stat-bars-and-fills)

## Frame 8 — Premium, подарки, каналы

- scene: значок Premium с вращающимся текстом, подарки выходят на орбиту, карточка канала
- duration: 3s
- transition_in: zoom-through
- status: animated
- src: compositions/f8-premium.html
- blueprint: constellation-hub (rules: orbit-3d-entry, ambient-glow-bloom)

## Frame 9 — Ночью не одиноко

- scene: слоган по словам, затем локап логотип + noctgram
- duration: 4s
- transition_in: cut
- status: animated
- src: compositions/f9-outro.html
- blueprint: titlecard-reveal → logo-assemble-lockup
