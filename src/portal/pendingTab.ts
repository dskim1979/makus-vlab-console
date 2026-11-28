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

export function sendPendingTab(tab: Window | null, url: string) {
  if (tab && !tab.closed) {
    try { tab.opener = null; } catch { /* the address is ours */ }
    tab.location.replace(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export function closePendingTab(tab: Window | null) {
  if (tab && !tab.closed) tab.close();
}
