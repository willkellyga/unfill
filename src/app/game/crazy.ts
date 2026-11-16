/**
 * The CrazyGames SDK (v3), used only by the portal build: vite.config.ts adds its script tag to the page, and
 * main.ts calls initCrazy() before anything reads a save. Everything here does nothing when the SDK isn't there
 * (the GitHub Pages build, a `?portal` preview, a blocked script, or a domain the SDK reports as "disabled"), so the
 * game falls back to plain localStorage.
 *
 * What it does for the game:
 * - progress (the run, the shelf, the high score, the Daily, settings) is kept by the SDK's Data Module, which saves
 *   it to a logged-in player's CrazyGames account and syncs it between their devices;
 * - CrazyGames' own mute button silences the game (it wins over the in-game sound setting without changing it);
 * - loading and gameplay events, so the portal knows when the game is loading, being played, or paused on a card;
 * - happytime() once a run, when it beats the player's best.
 *
 * Docs: https://docs.crazygames.com/sdk/intro/ , /sdk/data/ , /sdk/game/ , /requirements/account-integration/
 */

export interface CrazySettings {
  muteAudio: boolean;
  disableChat?: boolean;
}

interface CrazySDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  game: {
    settings: CrazySettings;
    addSettingsChangeListener(cb: (s: CrazySettings) => void): void;
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
  };
  user?: {
    addAuthListener?(cb: (user: unknown) => void): void;
  };
}

/** The SDK's init preloads the player's saved data; past this, play starts on this device's storage instead. */
const INIT_TIMEOUT_MS = 10_000;

let sdk: CrazySDK | null = null;

/** Starts the SDK. True when it's running (on CrazyGames, or in its local test mode on localhost). */
export async function initCrazy(): Promise<boolean> {
  const s = (window as unknown as { CrazyGames?: { SDK?: CrazySDK } }).CrazyGames?.SDK;
  if (!s) return false;
  let timer = 0;
  try {
    await Promise.race([
      s.init(),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('init timed out')), INIT_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    console.warn('CrazyGames SDK unavailable; saving on this device', e);
    return false;
  } finally {
    clearTimeout(timer);
  }
  if (s.environment === 'disabled') return false;
  sdk = s;
  return true;
}

/** Run an SDK call, never letting it break the game. */
function call<T>(f: (s: CrazySDK) => T, fallback: T): T {
  if (!sdk) return fallback;
  try {
    return f(sdk);
  } catch (e) {
    console.warn('CrazyGames SDK call failed', e);
    return fallback;
  }
}

/** The Data Module: the same shape as localStorage. */
export const crazyData = {
  get: (key: string): string | null => call((s) => s.data.getItem(key), null),
  set: (key: string, value: string): void => call((s) => s.data.setItem(key, value), undefined),
};

export const crazyGame = {
  loadingStart: () => call((s) => s.game.loadingStart(), undefined),
  loadingStop: () => call((s) => s.game.loadingStop(), undefined),
  gameplayStart: () => call((s) => s.game.gameplayStart(), undefined),
  gameplayStop: () => call((s) => s.game.gameplayStop(), undefined),
  happytime: () => call((s) => s.game.happytime(), undefined),
};

/** CrazyGames' mute, now and whenever the player changes it. */
export function onCrazyMute(cb: (muted: boolean) => void): void {
  cb(call((s) => !!s.game.settings.muteAudio, false));
  call((s) => s.game.addSettingsChangeListener((st) => cb(!!st.muteAudio)), undefined);
}

/** A player logging in (or out) mid-game: their account's progress replaces the guest's. */
export function onCrazyAuth(cb: () => void): void {
  call((s) => s.user?.addAuthListener?.(() => cb()), undefined);
}
