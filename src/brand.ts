// The one place the product's name and look are defined.
// MOAVI Desk: the VDI product of the MOAVI family. Change the name here only.
export const BRAND = {
  productName: 'MOAVI Desk',
  family: 'MOAVI',
  company: { ko: '(주)매커스시스템즈', en: 'MAKUS SYSTEMS Co., Ltd.' },
  // 원격 지원 요청: MAKUS SYSTEMS support portal (a white label's support link replaces it)
  supportUrl: 'https://support.makussystems.co.kr/',
  // 개선 요청 · 버그 신고: the product's GitHub issues (bug report / feature request templates); a white label may name its own
  feedbackUrl: 'https://github.com/dskim1979/makus-vlab-console/issues/new/choose',
  // MOAVI Desk Client (Windows MSI): the latest release, unless the engine's client settings name another download
  clientDownload: 'https://github.com/dskim1979/moavi-desk/releases/latest',
  tagline: {
    ko: '연구·개발·교육을 위한 가상 데스크톱과 자원 할당',
    en: 'Virtual desktops and shared resources for R&D and labs',
  },
} as const;

// Engine attribution (PegaProx, AGPL-3.0): shown in About and 운영 > 시스템 요약 only. The other
// screens show the company line (CompanyNotice) - a product decision; legal review of the
// engine's NOTICE section 7(b) for this separate console is pending.
export const ENGINE_NOTICE = {
  name: 'PegaProx',
  copyright: '© 2025-2026 PegaProx Team',
  license: 'AGPL-3.0',
  homepage: 'https://pegaprox.com',
  source: 'https://github.com/dskim1979/makus-vlab',   // the modified engine's Corresponding Source (AGPL-3.0 section 13)
} as const;
