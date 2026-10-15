// The one place the product's name and look are defined.
// The product name is not decided yet: change it here only.
export const BRAND = {
  productName: 'MAKUS vLAB',
  productTag: { ko: '가칭', en: 'working name' },
  company: { ko: '(주)매커스시스템즈', en: 'MAKUS SYSTEMS Co., Ltd.' },
  tagline: {
    ko: '연구·개발·교육을 위한 가상 데스크톱과 자원 할당',
    en: 'Virtual desktops and shared resources for R&D and labs',
  },
} as const;

// Engine attribution (PegaProx, AGPL-3.0): About, 운영 > 시스템 요약 and the console's
// navigation and workspace footers. Sign-in and first start show the company line instead
// (CompanyNotice) - a product decision; legal review of NOTICE section 7(b) is pending.
export const ENGINE_NOTICE = {
  name: 'PegaProx',
  copyright: '© 2025-2026 PegaProx Team',
  license: 'AGPL-3.0',
  homepage: 'https://pegaprox.com',
  source: 'https://github.com/dskim1979/makus-vlab',   // the modified engine's Corresponding Source (AGPL-3.0 section 13)
} as const;
