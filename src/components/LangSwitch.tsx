import { useI18n } from '../i18n';

export function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <button type="button" className="btn-ghost" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}>
      {t('app.lang')}
    </button>
  );
}
