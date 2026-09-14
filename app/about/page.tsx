/* App and authentication entry points restore their session through full navigation. */
/* eslint-disable next/no-html-link-for-pages */
import { publicPageMetadata, SITE_DESCRIPTION } from '@/lib/site-metadata';
import { NoctLogo } from '../stars-icon';
import './about.css';

export const metadata = publicPageMetadata(
  'О Noctgram — общение, публикации и музыка',
  SITE_DESCRIPTION,
  '/about',
);

export default function AboutPage() {
  return (
    <main className="about-noctgram">
      <a className="about-home" href="/" aria-label="Открыть Noctgram">
        <NoctLogo size={36} /> noctgram
      </a>
      <h1>Noctgram</h1>
      <p className="about-description">{SITE_DESCRIPTION}</p>
      <section>
        <h2>Публикации и каналы</h2>
        <p>
          Публикуйте текст, фотографии и видео, подписывайтесь на людей и
          каналы. Обсуждайте записи в комментариях и отвечайте другим
          участникам.
        </p>
      </section>
      <section>
        <h2>Личные и общие чаты</h2>
        <p>
          Переписывайтесь один на один и в группах, отправляйте вложения,
          отвечайте на сообщения и ставьте реакции.
        </p>
      </section>
      <section>
        <h2>Музыка и плейлисты</h2>
        <p>
          Находите музыку, сохраняйте понравившиеся треки и собирайте плейлисты.
          В плеере доступны очередь, повтор трека и совместное прослушивание.
        </p>
      </section>
      <section>
        <h2>Как начать</h2>
        <p>
          Откройте Noctgram в браузере. Для публикаций, подписок и переписки
          войдите по электронной почте и создайте профиль.
        </p>
        <div className="about-actions">
          <a className="primary" href="/">
            Открыть Noctgram
          </a>
          <a className="secondary" href="/login">
            Войти или зарегистрироваться
          </a>
        </div>
      </section>
      <footer>
        Официальный сайт — <a href="https://noctgram.com/">noctgram.com</a>
      </footer>
    </main>
  );
}
