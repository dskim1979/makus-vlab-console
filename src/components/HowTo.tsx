// A page or section intro kept to one line, with the how-to and caveats folded under "사용 방법".
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

export function HowTo({ children, label }: { children: ReactNode; label?: string }) {
  const { pick } = useI18n();
  return (
    <details className="howto">
      <summary>{label ?? pick({ ko: '사용 방법', en: 'How it works' })}</summary>
      <div className="howto-body">{children}</div>
    </details>
  );
}
