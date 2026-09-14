import { WelcomeProfile } from '../auth-screen';
import { ACCOUNT_ROBOTS } from '@/lib/site-metadata';
export const metadata = {
  title: 'Создать профиль Noctgram',
  robots: ACCOUNT_ROBOTS,
};
export default function WelcomePage() {
  return <WelcomeProfile />;
}
