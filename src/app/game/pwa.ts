/**
 * Home-screen app (plan: "Home-screen app (PWA)"). public/manifest.webmanifest names the app and its icons; the
 * service worker (written at build time by the `pwa` plugin in vite.config.ts) keeps every file of the game in a
 * cache, so once it has loaded one time it opens and plays with no connection.
 *
 * Not in the single-file artifact build (`__PWA__` is false there): a Claude artifact runs inside claude.ai's frame,
 * which can't host a service worker or be added to the home screen as an app.
 */
declare const __PWA__: boolean;

export interface InstallState {
  /** Running as the home-screen app rather than in a browser tab. */
  standalone: boolean;
  /** iPhone or iPad, where "Add to Home Screen" lives in Safari's Share menu (no install prompt). */
  ios: boolean;
  /** Is a service worker able to run here (a built site over https or localhost)? */
  offlineCapable: boolean;
  /** Does the offline copy exist yet? */
  offlineReady: boolean;
  /** Chrome/Android's own install prompt, when it offers one. */
  prompt: (() => Promise<void>) | null;
  /** The browser agreed not to clear this site's storage when space runs low. */
  persisted: boolean | null;
}

const state: InstallState = {
  standalone: false,
  ios: false,
  offlineCapable: false,
  offlineReady: false,
  prompt: null,
  persisted: null,
};

export function installState(): InstallState {
  return state;
}

interface DeferredPrompt extends Event {
  prompt(): Promise<void>;
}

/**
 * Register the service worker and ask for persistent storage. `onChange` is called when anything in the install
 * state changes; `toast` shows a short note (an update arrived).
 */
export function initPwa(onChange: () => void, toast: (msg: string) => void): void {
  const nav = navigator as Navigator & { standalone?: boolean };
  state.standalone = !!nav.standalone || !!window.matchMedia?.('(display-mode: standalone)').matches;
  state.ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const ev = e as DeferredPrompt;
    state.prompt = async () => {
      await ev.prompt();
      state.prompt = null;
      onChange();
    };
    onChange();
  });

  // Her run, shelf and high score live in this browser's storage. Ask the browser to keep it when space is short.
  // (Safari also deletes a site's storage after 7 days without a visit, but not for an app on the home screen.)
  void navigator.storage?.persisted?.().then((p) => {
    state.persisted = p;
    if (!p && state.standalone) {
      void navigator.storage.persist?.().then((ok) => {
        state.persisted = ok;
        onChange();
      });
    }
    onChange();
  });

  const swOk = __PWA__ && import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext && !new URLSearchParams(location.search).has('nosw');
  state.offlineCapable = swOk;
  if (!swOk) {
    onChange();
    return;
  }
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // a new version took over: this open copy keeps running as it is, and the next launch is the new one
    if (hadController) toast('Unfill updated: the new version starts next time you open it');
  });
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then(async () => {
      await navigator.serviceWorker.ready;
      state.offlineReady = true;
      onChange();
    })
    .catch(() => {
      state.offlineCapable = false;
      onChange();
    });
}
