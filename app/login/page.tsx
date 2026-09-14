import { EmailLogin } from '../auth-screen';
import { ACCOUNT_ROBOTS } from '@/lib/site-metadata';
export const metadata = { title: 'Войти в Noctgram', robots: ACCOUNT_ROBOTS };
export default function LoginPage() {
  return <EmailLogin />;
}
