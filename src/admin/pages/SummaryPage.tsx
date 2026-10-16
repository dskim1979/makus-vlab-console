import { adminApi } from '../../api/admin';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { useI18n } from '../../i18n';
import { Breakdown, StatTiles } from '../SummaryTiles';

// 운영 > 시스템 요약: the headline numbers, desktops by state, pools by type, versions.
export function SummaryPage() {
  const { t } = useI18n();
  const summary = useLoad(adminApi.summary);
  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn" onClick={summary.reload}><Icon name="refresh" size={16} />{t('common.refresh')}</button>
      </div>
      <LoadState value={summary} retry={summary.reload}>
        {(s) => (
          <>
            <StatTiles s={s} />
            <Breakdown s={s} />
            <p className="muted small">{t('sum.aboutHint')}</p>
          </>
        )}
      </LoadState>
    </>
  );
}
