import { ENGINE_NOTICE } from '../brand';

// "Powered by PegaProx" line. Shown on the login screen and in every layout's footer.
// AGPL-3.0 section 7(b) attribution of the engine (its NOTICE): never remove or hide it.
export function EngineNotice() {
  const n = ENGINE_NOTICE;
  return (
    <p className="engine-notice" id="engine-notice">
      Powered by{' '}
      <a href={n.homepage} target="_blank" rel="noreferrer">{n.name}</a>
      {' · '}{n.copyright}
      {' · '}{n.license}
      {' · '}
      <a href={n.source} target="_blank" rel="noreferrer">Source</a>
    </p>
  );
}
