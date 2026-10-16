import { useMemo, useState } from 'react';
import { ALL_GROUPS, BUNDLES, PROFILES, groupsFor, type FeatureGroup, type SiteProfile } from '../../api/features';
import { Icon, type IconName } from '../../components/Icon';
import { useFeatures } from '../../features';
import { useI18n } from '../../i18n';
import { visibleModules } from '../modules';

// "어떤 곳에서 쓰시나요?": the site profile, the bundles, and (in 플랫폼 설정 > 기능) each
// feature group on its own. Shown once after the first setup, and kept under the settings.

const PROFILE_TEXT: Record<SiteProfile, { icon: IconName; ko: [string, string]; en: [string, string] }> = {
  general: { icon: 'vm', ko: ['일반 업무 VDI', '사무실 · 지점 · 원격 근무, 데스크톱 100대 안팎. 데스크톱 · 풀 · 이미지, AD, 외부 접속, 감사 · 백업'],
    en: ['General VDI', 'Offices, branches, remote work, around 100 desktops: desktops, pools, images, AD, external access, audit, backup'] },
  small_lab: { icon: 'lab', ko: ['소규모 연구실', '연구실 5~30명. 데스크톱 · 풀 · 이미지 · 사용자 · 경보 · 백업만 — 가장 단순한 메뉴'],
    en: ['Small research lab', '5 to 30 people: desktops, pools, images, users, alerts, backup only - the simplest menu'] },
  university: { icon: 'users', ko: ['대학교 실습실', '실습실 · 수업. LAB · 단말 에이전트 · 시간표 · 예약 · 키오스크, 가입 신청 · 일괄 계정 · 부서'],
    en: ['University labs', 'Teaching labs: labs, terminal agents, timetables, bookings, kiosk, sign-up, bulk accounts, departments'] },
  research: { icon: 'shield', ko: ['연구소 · 기업 R&D', '큰 조직 · 보안 요구. 조직 · 권한, 외부 접속, 연구 데이터 · 반출 통제, 고가용성'],
    en: ['Institute or corporate R&D', 'Larger organisations with security needs: org and roles, external access, research data and export control, HA'] },
};

const GROUP_TEXT: Record<FeatureGroup, { ko: [string, string]; en: [string, string] }> = {
  lab: { ko: ['실습실 · LAB', 'LAB · 단말 에이전트 · 사용 일정 · 예약 · 키오스크 · 일정형 풀'], en: ['Labs', 'Labs, terminal agents, timetables, bookings, kiosk, scheduled pools'] },
  signup: { ko: ['가입 · 대량 계정', '가입 심사(포털 가입 신청), 부서'], en: ['Sign-up', 'Sign-up review (portal requests), departments'] },
  org: { ko: ['조직 · 권한', '부서, 역할, 유효 권한 조회'], en: ['Organisation and roles', 'Departments, roles, effective access'] },
  external: { ko: ['외부 접속', '게이트웨이(Guacamole · RD 게이트웨이), USB 장치 라이브러리, 외부 데스크톱'], en: ['External access', 'Gateways (Guacamole, RD Gateway), USB device library, external desktops'] },
  data: { ko: ['연구 데이터', '데이터셋, 파일 전송, 반출 승인 · 규칙, 용량'], en: ['Research data', 'Datasets, file transfer, export approval and rules, capacity'] },
  ha: { ko: ['고가용성', 'Proxmox HA, 서버 이중화'], en: ['High availability', 'Proxmox HA, server pair'] },
  fpga: { ko: ['FPGA 개발', '보드 LAB(JTAG), 빌드 팜, 라이선스 서버 · 좌석, 카드 대여 · 점검'], en: ['FPGA development', 'Board lab (JTAG), build farm, licence servers and seats, card loans and checks'] },
  gpuai: { ko: ['GPU · AI 연구', '카드 재고 · vGPU · MIG · 대여 · 실사용률, 환경 카탈로그, GPU 작업 큐 · 할당량, 웹 IDE'], en: ['GPU and AI research', 'Cards, vGPU, MIG, loans and utilisation, environments, GPU job queue and quotas, web IDE'] },
};

export function FeaturesChooser({ firstRun = false, onSaved }: { firstRun?: boolean; onSaved?: () => void }) {
  const { pick } = useI18n();
  const L = (ko: string, en: string) => pick({ ko, en });
  const f = useFeatures();
  const [profile, setProfile] = useState<SiteProfile>(f.profile ?? 'general');
  const [bundles, setBundles] = useState<FeatureGroup[]>(f.chosen && f.profile ? f.groups.filter((g) => BUNDLES.includes(g)) : []);
  const [custom, setCustom] = useState<FeatureGroup[] | null>(f.chosen && f.profile ? f.groups : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const groups = custom ?? groupsFor(profile, bundles);
  const preview = useMemo(() => visibleModules((g) => !g || g.length === 0 || g.some((x) => groups.includes(x))), [groups]);
  const pages = preview.reduce((n, m) => n + m.visiblePages.length, 0);

  function pickProfile(p: SiteProfile) { setProfile(p); setCustom(null); }
  function toggleBundle(b: FeatureGroup) { setCustom(null); setBundles((x) => (x.includes(b) ? x.filter((y) => y !== b) : [...x, b])); }
  function toggleGroup(g: FeatureGroup) { const now = custom ?? groups; setCustom(now.includes(g) ? now.filter((x) => x !== g) : [...now, g]); }

  async function save() {
    setBusy(true); setError(null); setDone(false);
    try { await f.save(profile, groups); setDone(true); onSaved?.(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="features">
      {firstRun && <p className="muted page-intro">{L('업무 특성에 맞는 메뉴만 보이게 합니다. 꺼진 기능은 데이터를 지우지 않으며, [플랫폼 설정 › 기능]에서 언제든 바꿀 수 있습니다.',
        'Only the menus your site needs are shown. Nothing is deleted when a feature is off, and you can change this any time under Platform settings › Features.')}</p>}
      <h2 className="section-title">{L('어떤 곳에서 쓰시나요?', 'Where is it used?')}</h2>
      <div className="profile-grid" role="radiogroup">
        {PROFILES.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={profile === p} className={`profile-card${profile === p ? ' on' : ''}`} onClick={() => pickProfile(p)}>
            <span className="profile-icon"><Icon name={PROFILE_TEXT[p].icon} size={22} /></span>
            <span className="strong">{pick({ ko: PROFILE_TEXT[p].ko[0], en: PROFILE_TEXT[p].en[0] })}</span>
            <span className="muted small">{pick({ ko: PROFILE_TEXT[p].ko[1], en: PROFILE_TEXT[p].en[1] })}</span>
          </button>
        ))}
      </div>

      <h3 className="features-sub">{L('연구 분야 추가', 'Add for your research')}</h3>
      <div className="bundle-row">
        {BUNDLES.map((b) => (
          <label key={b} className={`mode-card${groups.includes(b) ? ' on' : ''}`}>
            <input type="checkbox" checked={groups.includes(b)} onChange={() => toggleBundle(b)} />
            <span className="strong">{pick({ ko: GROUP_TEXT[b].ko[0], en: GROUP_TEXT[b].en[0] })}</span>
            <span className="muted small">{pick({ ko: GROUP_TEXT[b].ko[1], en: GROUP_TEXT[b].en[1] })}</span>
          </label>
        ))}
      </div>

      {!firstRun && (
        <details className="features-detail" open={custom !== null}>
          <summary>{L('기능 하나씩 켜고 끄기', 'Switch features one by one')}</summary>
          <div className="group-list">
            {ALL_GROUPS.filter((g) => !BUNDLES.includes(g)).map((g) => (
              <label key={g} className="check">
                <input type="checkbox" checked={groups.includes(g)} onChange={() => toggleGroup(g)} />
                <span><span className="strong">{pick({ ko: GROUP_TEXT[g].ko[0], en: GROUP_TEXT[g].en[0] })}</span>
                  <span className="muted small"> — {pick({ ko: GROUP_TEXT[g].ko[1], en: GROUP_TEXT[g].en[1] })}</span></span>
              </label>
            ))}
          </div>
          <p className="muted small">{L('데스크톱 · 풀 · 이미지 · 사용자 · 클러스터 · 경보 · 백업 · 보고서 · 감사 · 공지 · 클라이언트 · 서포트 번들은 항상 켜져 있습니다.',
            'Desktops, pools, images, users, cluster, alerts, backup, reports, audit, notices, client and the support bundle are always on.')}</p>
        </details>
      )}

      <section className="panel features-preview">
        <h3 className="panel-title">{L(`이렇게 바뀝니다 — 메뉴 ${preview.length}개 · 화면 ${pages}개`, `What you get - ${preview.length} menus, ${pages} pages`)}</h3>
        <ul className="preview-list">
          {preview.map((m) => (
            <li key={m.id}><span className="strong">{pick(m.label)}</span> <span className="muted small">{m.visiblePages.map((p) => pick(p.label)).join(' · ')}</span></li>
          ))}
        </ul>
      </section>
      {error && <div className="alert error small" role="alert">{error}</div>}
      {done && !firstRun && <div className="alert info small" role="status">{L('저장했습니다. 메뉴가 바뀌었습니다.', 'Saved. The menu has changed.')}</div>}
      <div className="toolbar">
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{firstRun ? L('이대로 시작', 'Start with this') : L('저장', 'Save')}</button>
      </div>
    </div>
  );
}

export function FeaturesPage() {
  return <FeaturesChooser />;
}
