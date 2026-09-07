'use client';
import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { StarsIcon } from './stars-icon';

const particles = Array.from({ length: 28 }, (_, i) => {
  const angle = ((-168 + ((i * 47) % 156)) * Math.PI) / 180;
  const reach = 76 + ((i * 31) % 91);
  return {
    '--burst-x': `${Math.cos(angle) * reach}px`,
    '--burst-y': `${Math.sin(angle) * reach - 32}px`,
    '--burst-fall': `${32 + ((i * 13) % 58)}px`,
    '--burst-turn': `${(i % 2 ? 1 : -1) * (90 + ((i * 29) % 220))}deg`,
    '--burst-delay': `${(i % 7) * 34}ms`,
    '--burst-duration': `${1300 + ((i * 41) % 550)}ms`,
    '--burst-size': `${13 + ((i * 7) % 15)}px`,
  } as CSSProperties;
});

export function StarsTopupCelebration({
  amount,
  onComplete,
}: {
  amount: number;
  onComplete: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 3800);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return createPortal(
    <div className="stars-topup-celebration">
      <div className="stars-topup-particles" aria-hidden="true">
        {particles.map((style, i) => (
          <span className="stars-topup-flight" style={style} key={i}>
            {i % 3 === 0 ? (
              <i className="stars-topup-spark" />
            ) : (
              <StarsIcon className="stars-topup-particle" />
            )}
          </span>
        ))}
      </div>
      <output
        className="stars-topup-receipt"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="stars-topup-seal" aria-hidden="true">
          <StarsIcon size={34} />
        </span>
        <span className="stars-topup-copy">
          <strong>+{amount.toLocaleString('ru-RU')} звёзд</strong>
          <span>Баланс пополнен</span>
        </span>
        <span className="stars-topup-check" aria-hidden="true">
          ✓
        </span>
      </output>
    </div>,
    document.body,
  );
}
