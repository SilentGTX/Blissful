// Document Picture-in-Picture helpers (Chromium 116+). A real, OS-level,
// top-level window that can be dragged to ANY monitor — unlike an in-page
// floating div, which is forever trapped inside the browser viewport.
//
// IMPORTANT: the API is only exposed in a SECURE CONTEXT (https or localhost).
// Over plain http on a LAN IP `window.documentPictureInPicture` is undefined,
// so callers must fall back to the in-page mini window.

export type DocPiP = {
  requestWindow: (o?: { width?: number; height?: number }) => Promise<Window>;
};

export function getDocPiP(): DocPiP | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { documentPictureInPicture?: DocPiP }).documentPictureInPicture ?? null;
}

// The PiP window is a SEPARATE document with no stylesheets — clone the main
// document's CSS into it so the player renders identically, and carry over the
// runtime CSS custom properties (accent colour, subtitle size) set on <html>.
export function copyStylesToPiP(pip: Window) {
  const doc = pip.document;
  for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
    try { doc.head.appendChild(node.cloneNode(true)); } catch { /* noop */ }
  }
  // Constructed/adopted stylesheets (Vite injects some styles this way).
  try {
    const srcAdopted = (document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    if (srcAdopted.length) {
      const PipSheet = (pip as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet;
      const clones = srcAdopted.map((sheet) => {
        const c = new PipSheet();
        for (const rule of Array.from(sheet.cssRules)) c.insertRule(rule.cssText, c.cssRules.length);
        return c;
      });
      (doc as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = clones;
    }
  } catch { /* best-effort */ }
  // Theme class (dark mode) + runtime CSS vars set inline on <html>.
  doc.documentElement.className = document.documentElement.className;
  doc.documentElement.style.cssText = document.documentElement.style.cssText;
  doc.documentElement.style.height = '100%';
  doc.body.style.cssText = 'margin:0;height:100%;position:relative;background:#000;overflow:hidden;';
}
