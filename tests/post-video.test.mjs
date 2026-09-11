import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  entryPoints: ['app/post-card.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'post-surroundings',
      setup(build) {
        build.onResolve(
          { filter: /^(react(?:-dom)?(?:\/.*)?|lucide-react)$/ },
          ({ path }) => ({
            path: pathToFileURL(require.resolve(path)).href,
            external: true,
          }),
        );
        build.onResolve(
          {
            filter:
              /^(\.\/(profile-identity|profile-link|stars-icon|code-block|music-link-card)|@\/components\/ui\/(dropdown-menu|dialog))$/,
          },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
        export const Avatar = () => null;
        export const appearanceStyle = () => ({});
        export const DisplayName = ({person}) => person.name;
        export const ProfileLink = ({children}) => children;
        export const MentionText = ({text}) => text;
        export const StarsIcon = () => null;
        export const CodeBlock = () => null;
        export const MusicLinkCard = () => null;
        export const DropdownMenu = ({children}) => children;
        export const DropdownMenuTrigger = ({children}) => children;
        export const DropdownMenuContent = () => null;
        export const DropdownMenuItem = () => null;
        export const Dialog = () => null;
        export const DialogContent = () => null;
        export const DialogTitle = () => null;
      `,
        }));
      },
    },
  ],
});
const { PostCard } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64')
);
const clip = { id: 'clip 1', name: 'Видео.mp4', type: 'video/mp4' };
const photo = { id: 'photo', name: 'Фото.jpg', type: 'image/jpeg' };
const renderPost = (media, adult = false) =>
  renderToStaticMarkup(
    createElement(PostCard, {
      p: {
        id: 'post',
        userId: 'author',
        name: 'Автор',
        handle: 'author',
        created: 1,
        text: 'Подпись к видео',
        media,
        adult,
        votes: [],
        poll: [],
      },
      busy: false,
    }),
  );
const html = renderPost([clip]);
assert.equal((html.match(/class="chat-video-player"/g) || []).length, 1);
assert.match(html, /<video[^>]+src="\/api\/media\/clip%201"/);
assert.doesNotMatch(
  html,
  /<video[^>]*\s(?:controls|autoPlay|autoplay)(?:=|\s|>)/,
);
for (const label of [
  'Воспроизвести видео',
  'Перемотка видео',
  'Выключить звук видео',
  'Раскрыть видео',
  'Скачать видео Видео.mp4',
]) {
  assert.ok(html.includes('aria-label="' + label + '"'), label);
}
assert.ok(html.includes('Подпись к видео'));
const mixed = renderPost([photo, clip, { ...clip, id: 'clip2' }]);
assert.equal((mixed.match(/class="chat-video-player"/g) || []).length, 2);
assert.match(mixed, /<button[^>]*aria-label="Открыть Фото.jpg"/);
assert.match(mixed, /<img[^>]*src="\/api\/media\/photo"/);
const hidden = renderPost([clip], true);
assert.match(hidden, /Показать фото и видео/);
assert.doesNotMatch(
  hidden,
  /<video|class="chat-video-player"|\/api\/media\/clip/,
);
assert.doesNotMatch(renderPost([photo]), /<video|class="chat-video-player"/);
console.log(
  'Feed videos use the shared player; multiple media, captions, photo viewing and sensitive video gating are preserved.',
);
