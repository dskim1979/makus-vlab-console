import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { Loaded } from './useLoad';

// Loading / error frame around a loaded value; renders children only when it is there.
export function LoadState<T>({ value, retry, children }: {
  value: Loaded<T>;
  retry?: () => void;
  children: (data: T) => ReactNode;
}) {
  const { t } = useI18n();
  if (value.state === 'loading') return <p className="muted">{t('app.loading')}</p>;
  if (value.state === 'error') {
    return (
      <div className="alert error" role="alert">
        {t('common.loadFailed')}: {value.message}
        {retry && <> <button type="button" className="btn-ghost" onClick={retry}>{t('common.retry')}</button></>}
      </div>
    );
  }
  return <>{children(value.data)}</>;
}
