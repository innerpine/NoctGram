/** OTP expiry follows the server clock, even when the device clock is wrong
 * or changes while the mail app is open. performance.now() is monotonic. */
export function authCodeClock(
  serverTime: number,
  monotonicNow = () => performance.now(),
) {
  const received = monotonicNow();
  return () => serverTime + Math.max(0, monotonicNow() - received);
}
