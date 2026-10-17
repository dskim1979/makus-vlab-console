import { useEffect, useState } from 'react';
import { accountsApi, type PasswordPolicy } from '../api/accounts';
import { ApiError } from '../api/client';
import { useI18n } from '../i18n';

// One password for the portal and the desktops (the bundled directory, makus-vlab
// pegaprox/vlab/directory.py password_policy): the rule the engine checks - the portal's policy
// and the directory's together - shown under a new-password field and checked before sending,
// so a password the portal takes is one the desktops take too.

let cached: Promise<PasswordPolicy> | null = null;

export function usePasswordPolicy(given?: PasswordPolicy | null): PasswordPolicy | null {
  const [p, setP] = useState<PasswordPolicy | null>(given ?? null);
  useEffect(() => {
    if (given) { setP(given); return; }
    cached ??= accountsApi.passwordPolicy().catch((e) => { cached = null; throw e; });
    let live = true;
    cached.then((v) => live && setP(v)).catch(() => undefined);
    return () => { live = false; };
  }, [given]);
  return p;
}

type L = (ko: string, en: string) => string;

/** What is still missing, in the words the list shows; [] when the password fits. */
export function policyProblems(pw: string, p: PasswordPolicy, L: L, names: string[] = []): string[] {
  const out: string[] = [];
  if (pw.length < p.min_length) out.push(L(`${p.min_length}자 이상`, `${p.min_length}+ characters`));
  if (p.uppercase && !/[A-Z]/.test(pw)) out.push(L('대문자', 'an upper-case letter'));
  if (p.lowercase && !/[a-z]/.test(pw)) out.push(L('소문자', 'a lower-case letter'));
  if (p.numbers && !/[0-9]/.test(pw)) out.push(L('숫자', 'a digit'));
  if (p.special && !/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(pw)) out.push(L('특수 문자', 'a symbol'));
  if (p.complexity) {
    const kinds = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (kinds < 3) out.push(L('대문자 · 소문자 · 숫자 · 기호 중 세 가지', 'three of upper, lower, digits, symbols'));
    const low = pw.toLowerCase();
    const parts = names.flatMap((n) => (n || '').toLowerCase().split(/[\s,._\-#\t]+/)).filter((x) => x.length >= 3);
    if (parts.some((x) => low.includes(x))) out.push(L('아이디 · 이름이 들어가지 않게', 'no username or name in it'));
  }
  return out;
}

export function policyText(p: PasswordPolicy, L: L) {
  const parts = [L(`${p.min_length}자 이상`, `${p.min_length}+ characters`)];
  if (p.uppercase) parts.push(L('대문자', 'upper case'));
  if (p.lowercase) parts.push(L('소문자', 'lower case'));
  if (p.numbers) parts.push(L('숫자', 'a digit'));
  if (p.special) parts.push(L('특수 문자', 'a symbol'));
  if (p.complexity) parts.push(L('네 종류 중 세 가지 · 아이디 · 이름 제외', 'three kinds, no username or name'));
  return parts.join(' · ');
}

/** The rule under a new-password field: what is still missing while typing, and - with the
 *  bundled directory - that this one password is also the desktop sign-in. */
export function PasswordRules({ policy, pw, names = [] }: { policy: PasswordPolicy | null; pw: string; names?: string[] }) {
  const { pick } = useI18n();
  const L: L = (ko, en) => pick({ ko, en });
  if (!policy) return null;
  const missing = pw ? policyProblems(pw, policy, L, names) : [];
  return (
    <>
      <small className="muted">{L('규칙', 'Rule')}: {policyText(policy, L)}
        {pw && (missing.length ? <span className="pw-missing"> — {L('남은 것', 'still missing')}: {missing.join(', ')}</span>
          : <span className="pw-ok"> — {L('맞음', 'OK')}</span>)}</small>
      {policy.unified && <UnifiedNote domain={policy.domain} />}
    </>
  );
}

export function UnifiedNote({ domain }: { domain?: string }) {
  const { pick } = useI18n();
  return (
    <div className="alert info small" role="note">
      {pick({ ko: `이 비밀번호로 포털과 데스크톱 모두 로그인합니다${domain ? ` (데스크톱에서는 ${domain}\\아이디)` : ''}.`,
        en: `This one password signs you in to the portal and to the desktops${domain ? ` (${domain}\\username on a desktop)` : ''}.` })}
    </div>
  );
}

/** An account call's error in words the user can act on: the directory's rule, or the directory
 *  away (then nothing changed, neither in the portal). */
export function accountErrorText(err: unknown, L: L): string {
  const e = err as ApiError & { body?: { code?: string; error?: string } };
  const code = e?.body && typeof e.body === 'object' ? e.body.code : undefined;
  if (code === 'PASSWORD_POLICY') return L(`비밀번호 규칙에 맞지 않습니다: ${e.message}`, `The password does not fit the rule: ${e.message}`);
  if (code === 'PASSWORD_REFUSED') return L(`디렉터리가 이 비밀번호를 받지 않았습니다: ${e.message}. 다른 비밀번호를 정하세요.`,
    `The directory refused this password: ${e.message}. Choose another one.`);
  if (e?.status === 503 || code === 'UNREACHABLE' || code === 'NO_SERVICE_ACCOUNT') {
    return L('디렉터리(DC)에 연결할 수 없어 바꾸지 못했습니다. 포털과 데스크톱의 비밀번호는 그대로입니다. 잠시 뒤 다시 하거나 관리자에게 알리세요.',
      'The directory (DC) could not be reached, so nothing changed - the portal and desktop password stay as they were. Try again later or tell the administrator.');
  }
  return (err as Error)?.message ?? String(err);
}
