// noVNC ships CommonJS without types; this is the part of RFB the console uses.
declare module '@novnc/novnc/lib/rfb' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { credentials?: { password?: string } });
    scaleViewport: boolean;
    resizeSession: boolean;
    disconnect(): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
    focus(): void;
  }
}
