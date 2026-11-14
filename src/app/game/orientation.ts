/**
 * Phones play Unfill upright. Turning one sideways used to reframe the 3D tray for a short, wide screen, and on iPhone
 * the trip back to portrait could leave the page zoomed in or the camera framed for the old size, so taps landed on
 * the wrong blocks.
 *
 * What each platform honors:
 * - Android, installed app: the manifest's "orientation": "portrait" locks it; `lock()` below covers an install made
 *   before that field, and full screen. In a plain browser tab Android, like iPhone, refuses any lock.
 * - iPhone, Safari and the home-screen app: ignore the manifest's orientation and have no lock API at all. They get a
 *   "turn your phone upright" card over the game, which also keeps taps off the tray while it's sideways.
 * - Tablets and computers: any orientation; the layout fits the tray to whatever screen it has.
 *
 * Zoom: the viewport tag stops the automatic zoom iOS applies on rotation, and touch-action plus the guards here stop
 * pinch and double-tap zoom (iPhone Safari ignores user-scalable=no, so its gesture events are cancelled too).
 */

/** A phone-sized touch screen: the short side of the screen is under 600 CSS px (iPads and tablets are wider). */
export function isPhone(): boolean {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const short = Math.min(screen.width || 0, screen.height || 0);
  return coarse && short > 0 && short < 600;
}

/** The device is held sideways. Uses the device's own orientation where there is one, not the page's size. */
export function isLandscape(): boolean {
  const type = screen.orientation?.type;
  if (type) return type.startsWith('landscape');
  const legacy = (window as { orientation?: unknown }).orientation;
  if (typeof legacy === 'number') return Math.abs(legacy) === 90;
  return window.innerWidth > window.innerHeight;
}

/** Ask for a portrait lock where the browser allows one (an installed Android app, or full screen). */
export function lockPortrait(): void {
  const o = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
  try {
    o?.lock?.('portrait').catch(() => {
      /* refused outside an installed app: the upright card covers it */
    });
  } catch {
    /* not supported */
  }
}

/** Cancel pinch and double-tap zoom everywhere, while one-finger scrolling (settings, shelf) still works. */
export function preventZoom(): void {
  const stop = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  // iPhone Safari's own pinch events
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
  // a second finger down is a pinch anywhere
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) stop(e);
    },
    { passive: false },
  );
  // double-tap zoom is off through touch-action: manipulation (style.css), which every iOS since 13 honors
  document.addEventListener('dblclick', stop, { passive: false });
}

/**
 * iOS can stay zoomed in after a rotation even with maximum-scale=1. Re-setting the viewport tag makes it apply the
 * tag again, which snaps the zoom back to 1. Also undoes the small scroll iOS sometimes leaves on a fixed page.
 */
export function resetZoom(): void {
  const vv = window.visualViewport;
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  if (!vv || Math.abs(vv.scale - 1) < 0.01) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const content = meta.content;
  meta.content = content.replace(/initial-scale=[\d.]+/, 'initial-scale=1.0001');
  requestAnimationFrame(() => {
    meta.content = content;
  });
}
