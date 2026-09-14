import Noctgram from '../../noctgram';
import { ACCOUNT_ROBOTS } from '@/lib/site-metadata';
export const metadata = {
  title: 'Музыкальные сервисы — Noctgram',
  robots: ACCOUNT_ROBOTS,
};
export default function MusicServicesPage() {
  return <Noctgram initialPage="music-services" />;
}
