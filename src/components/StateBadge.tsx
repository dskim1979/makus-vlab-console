import type { DesktopState } from '../api/types';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';

export function StateBadge({ state }: { state: DesktopState }) {
  const { t } = useI18n();
  return <span className={`badge state-${state}`}>{t(`portal.state.${state}` as MessageKey)}</span>;
}
