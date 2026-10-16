import { adminApi } from '../../api/admin';
import { Icon } from '../../components/Icon';
import { LoadState } from '../../components/LoadState';
import { useLoad } from '../../components/useLoad';
import { ENGINE_NOTICE } from '../../brand';
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
            <section className="panel versions">
              <h2 className="section-title">{t('sum.versions')}</h2>
              <dl className="about-list">
                <dt>{t('sum.console')}</dt><dd>{__APP_VERSION__}</dd>
                <dt>{t('sum.engine')}</dt><dd>{s.versions.engine} · Desk API {s.versions.vlab_api}</dd>
                {s.versions.build && <><dt>{t('sum.build')}</dt><dd>{s.versions.build}</dd></>}
                <dt>{t('about.engine')}</dt>
                <dd>
                  Powered by <a href={ENGINE_NOTICE.homepage} target="_blank" rel="noreferrer">{ENGINE_NOTICE.name}</a>
                  {' · '}{ENGINE_NOTICE.copyright} · {ENGINE_NOTICE.license}
                  <br />
                  {t('about.source')}: <a href={ENGINE_NOTICE.source} target="_blank" rel="noreferrer">{ENGINE_NOTICE.source}</a>
                </dd>
              </dl>
            </section>
          </>
        )}
      </LoadState>
    </>
  );
}
