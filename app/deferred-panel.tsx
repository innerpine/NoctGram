'use client';
import {
  lazy,
  Suspense,
  Component,
  type ComponentType,
  type ReactNode,
  useState,
} from 'react';

class PanelError extends Component<
  { children: ReactNode; retry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="panel-loading" role="alert">
        Не удалось загрузить раздел.{' '}
        <button className="secondary" onClick={this.props.retry}>
          Повторить
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
/** Only the opened section loads its code. Preloading uses the same promise. */
export function deferredPanel<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
) {
  let promise: ReturnType<typeof loader> | undefined;
  const preload = () =>
    (promise ??= loader().catch((error) => {
      promise = undefined;
      throw error;
    }));
  const Initial = lazy(preload);
  function Deferred(props: P) {
    const [view, setView] = useState(() => ({ Lazy: Initial, key: 0 }));
    return (
      <PanelError
        key={view.key}
        retry={() =>
          setView(({ key }) => ({ Lazy: lazy(preload), key: key + 1 }))
        }
      >
        <Suspense
          fallback={<output className="panel-loading">Загрузка…</output>}
        >
          <view.Lazy {...props} />
        </Suspense>
      </PanelError>
    );
  }
  return Object.assign(Deferred, { preload });
}
