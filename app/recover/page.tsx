import { RecoveryScreen } from '../recovery-screen';
import { ACCOUNT_ROBOTS } from '@/lib/site-metadata';
export const metadata = {
  title: 'Восстановить аккаунт Noctgram',
  robots: ACCOUNT_ROBOTS,
};
export default function Page() {
  return <RecoveryScreen />;
}
