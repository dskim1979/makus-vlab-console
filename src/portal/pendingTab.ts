// A new tab opened at the click and sent to its address once the server answers: the tab shows at
// once (not after the connect request), and a popup blocker lets it through as the click's own.
export function openPendingTab(text: string): Window | null {
  const tab = window.open('about:blank', '_blank');
  if (!tab) return null;
  try {
    tab.document.title = text;
    const p = tab.document.createElement('p');
    p.textContent = text;
    p.style.cssText = 'font: 15px system-ui, sans-serif; color: #555; margin: 40vh auto 0; text-align: center;';
    tab.document.body.appendChild(p);
  } catch { /* a browser that will not let us write it: the blank tab still goes on to the address */ }
  return tab;
}

// Sends the tab on as the web IDE does (location.href). The opener is left as it is: cutting it first
// could leave the tab where it was (seen on the test server: every other click stayed on the blank
// tab). If the tab is still blank a moment later it is told again, then a new tab is opened.
export function sendPendingTab(tab: Window | null, url: string) {
  if (!tab || tab.closed) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const go = () => { try { tab.location.href = url; return true; } catch { return false; } };
  if (!go()) { window.open(url, '_blank', 'noopener'); return; }
  const stillBlank = () => { try { return !tab.closed && tab.location.href === 'about:blank'; } catch { return false; } };   // cross-origin = it left
  window.setTimeout(() => {
    if (!stillBlank()) return;
    go();
    window.setTimeout(() => { if (stillBlank()) { tab.close(); window.open(url, '_blank', 'noopener'); } }, 1500);
  }, 1500);
}

export function closePendingTab(tab: Window | null) {
  if (tab && !tab.closed) tab.close();
}
