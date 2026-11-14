/**
 * The "Add to Home Screen" welcome card (Will, Nov 14): the first time someone opens the game in a phone's browser,
 * a card shows how to put Unfill on the home screen, where it opens full screen, plays offline and keeps its save.
 *
 * Android Chrome lets a page offer its own install prompt, so there it's one button. iPhone has no such thing (Apple
 * only lets the person add a site from Safari's Share menu), so the card shows the taps, each with a small drawing of
 * the button to look for. The drawings are our own simple pictures of those buttons, not Apple's or Google's
 * artwork, and are matched to the browser: Safari before and from iOS 26 (whose Share button moved into the ••• menu),
 * Chrome on iPhone, other in-app browsers (open it in Safari first), and Android without the prompt.
 */

export type BrowserKind = 'ios-safari-26' | 'ios-safari' | 'ios-chrome' | 'ios-other' | 'android' | 'other';

export function browserKind(ua: string, maxTouchPoints = 0, platform = ''): BrowserKind {
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (ios) {
    if (/CriOS\//.test(ua)) return 'ios-chrome';
    // Safari's own UA ends "Version/NN ... Safari/..."; apps that show pages inside themselves (Facebook, Instagram,
    // Gmail, the Google app) leave out "Version/" or add their own name
    const safari = /Version\/(\d+)/.exec(ua);
    if (!safari || /FBAN|FBAV|Instagram|GSA\/|FxiOS|EdgiOS|Line\//.test(ua)) return 'ios-other';
    return Number(safari[1]) >= 26 ? 'ios-safari-26' : 'ios-safari';
  }
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

// ---------------------------------------------------------------- drawings

const INK = '#5a3f33';
const GREY = '#8e8e93';
const HI = '#cf6c5f';
const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${body}</svg>`;
/** A pulsing ring around the thing to tap. */
const ring = (cx: number, cy: number, r: number) =>
  `<circle class="tapRing" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${HI}" stroke-width="2.5"/>`;
/** Safari's Share symbol: a square open at the top with an arrow up out of it. */
const shareIcon = (x: number, y: number, s = 1, c = '#007aff') =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M-4.5 -2H-7V9H7V-2H4.5"/><path d="M0 4V-9M-3.5 -5.5L0 -9L3.5 -5.5"/></g>`;
/** The Add to Home Screen symbol: a plus in a rounded square. */
const plusSquare = (x: number, y: number, c = INK) =>
  `<g transform="translate(${x} ${y})" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"><rect x="-8" y="-8" width="16" height="16" rx="4"/><path d="M0 -4V4M-4 0H4"/></g>`;
const text = (x: number, y: number, s: string, o: { size?: number; weight?: number; fill?: string; anchor?: string } = {}) =>
  `<text x="${x}" y="${y}" font-family="-apple-system, system-ui, sans-serif" font-size="${o.size ?? 13}" font-weight="${o.weight ?? 500}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? 'start'}">${s}</text>`;

/** iOS 26 Safari's bottom bar: back, the address, and the ••• button (circled). */
const safari26Bar = () =>
  svg(
    250,
    54,
    `<rect x="1" y="5" width="248" height="44" rx="22" fill="#fff" stroke="#e5e5ea"/>` +
      `<path d="M24 19L16 27L24 35" fill="none" stroke="${GREY}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<rect x="40" y="13" width="160" height="28" rx="14" fill="#f2f2f7"/>` +
      text(120, 32, 'willkellyga.github.io', { size: 12, anchor: 'middle', fill: '#3a3a3c' }) +
      `<g fill="${INK}"><circle cx="216" cy="27" r="2.2"/><circle cx="224" cy="27" r="2.2"/><circle cx="232" cy="27" r="2.2"/></g>` +
      ring(224, 27, 17),
  );

/** The ••• menu with Share circled. */
const safari26Menu = () =>
  svg(
    250,
    54,
    `<rect x="1" y="1" width="248" height="52" rx="16" fill="#fff" stroke="#e5e5ea"/>` +
      `<rect x="9" y="8" width="232" height="38" rx="10" fill="#fdecea"/>` +
      shareIcon(30, 28, 1, INK) +
      text(50, 32, 'Share', { size: 14, weight: 600 }) +
      `<rect class="tapRing" x="7" y="6" width="236" height="42" rx="12" fill="none" stroke="${HI}" stroke-width="2.5"/>`,
  );

/** Older Safari's bottom toolbar: back, forward, Share (circled), bookmarks, tabs. */
const safariToolbar = () =>
  svg(
    250,
    50,
    `<rect x="1" y="1" width="248" height="48" rx="12" fill="#f9f9fb" stroke="#e5e5ea"/>` +
      `<g fill="none" stroke="#007aff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M30 17L22 25L30 33"/><path d="M70 17L78 25L70 33" stroke="#c7c7cc"/>` +
      `<path d="M163 18C158 16 153 16 149 18V33C153 31 158 31 163 33C167 31 172 31 176 33V18C172 16 167 16 163 18ZM163 18V33"/><rect x="209" y="17" width="14" height="14" rx="3"/><path d="M213 14H226V27"/></g>` +
      shareIcon(125, 27, 1.1) +
      ring(125, 25, 17),
  );

/** Chrome on iPhone: the address bar with its Share button (circled). */
const chromeIosBar = () =>
  svg(
    250,
    50,
    `<rect x="1" y="1" width="248" height="48" rx="12" fill="#f9f9fb" stroke="#e5e5ea"/>` +
      `<rect x="12" y="10" width="190" height="30" rx="15" fill="#ececf0"/>` +
      text(107, 30, 'willkellyga.github.io', { size: 12, anchor: 'middle', fill: '#3a3a3c' }) +
      shareIcon(226, 27, 1, '#1a73e8') +
      ring(226, 25, 16),
  );

/** The Share sheet's "Add to Home Screen" row (circled). */
const addRow = () =>
  svg(
    250,
    54,
    `<rect x="1" y="1" width="248" height="52" rx="16" fill="#fff" stroke="#e5e5ea"/>` +
      `<rect x="9" y="8" width="232" height="38" rx="10" fill="#fdecea"/>` +
      plusSquare(30, 27) +
      text(50, 32, 'Add to Home Screen', { size: 14, weight: 600 }) +
      `<rect class="tapRing" x="7" y="6" width="236" height="42" rx="12" fill="none" stroke="${HI}" stroke-width="2.5"/>`,
  );

/** The last screen: the app's icon and name, Add (circled), and on iOS 26 "Open as Web App" switched on. */
const addScreen = (webAppSwitch: boolean) =>
  svg(
    250,
    webAppSwitch ? 104 : 74,
    `<rect x="1" y="1" width="248" height="${webAppSwitch ? 102 : 72}" rx="16" fill="#fff" stroke="#e5e5ea"/>` +
      text(16, 26, 'Cancel', { fill: '#007aff' }) +
      text(122, 26, 'Add to Home Screen', { size: 11, weight: 600, anchor: 'middle' }) +
      text(220, 26, 'Add', { fill: '#007aff', weight: 700, anchor: 'middle' }) +
      ring(220, 21, 17) +
      `<image href="icons/icon-192.png" x="18" y="38" width="26" height="26"/>` +
      text(54, 56, 'Unfill', { size: 14, weight: 600 }) +
      (webAppSwitch
        ? `<path d="M9 74H241" stroke="#e5e5ea"/>` +
          text(18, 94, 'Open as Web App', { size: 13 }) +
          `<rect x="196" y="80" width="40" height="22" rx="11" fill="#34c759"/><circle cx="225" cy="91" r="9" fill="#fff"/>`
        : ''),
  );

/** Chrome on Android: the ⋮ menu button (circled). */
const androidBar = () =>
  svg(
    250,
    50,
    `<rect x="1" y="1" width="248" height="48" rx="12" fill="#f8f9fa" stroke="#e3e3e3"/>` +
      `<rect x="12" y="10" width="194" height="30" rx="15" fill="#eceff1"/>` +
      text(109, 30, 'willkellyga.github.io', { size: 12, anchor: 'middle', fill: '#3c4043' }) +
      `<g fill="#3c4043"><circle cx="228" cy="17" r="2.2"/><circle cx="228" cy="25" r="2.2"/><circle cx="228" cy="33" r="2.2"/></g>` +
      ring(228, 25, 15),
  );

/** Chrome on Android's menu: "Add to home screen" (circled). */
const androidMenu = () =>
  svg(
    250,
    54,
    `<rect x="1" y="1" width="248" height="52" rx="12" fill="#fff" stroke="#e3e3e3"/>` +
      `<rect x="9" y="8" width="232" height="38" rx="8" fill="#fdecea"/>` +
      `<g fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"><rect x="21" y="16" width="13" height="21" rx="3"/><path d="M27.5 22V31M23 26.5H32"/></g>` +
      text(46, 32, 'Add to home screen', { size: 14, weight: 600 }) +
      `<rect class="tapRing" x="7" y="6" width="236" height="42" rx="10" fill="none" stroke="${HI}" stroke-width="2.5"/>`,
  );

// ---------------------------------------------------------------- the card

export interface Step {
  html: string;
  pic: string;
}

export function stepsFor(kind: BrowserKind): Step[] {
  switch (kind) {
    case 'ios-safari-26':
      return [
        { html: 'Tap the <b>•••</b> button at the bottom right.', pic: safari26Bar() },
        { html: 'Tap <b>Share</b>.', pic: safari26Menu() },
        { html: 'Tap <b>Add to Home Screen</b>. If you don’t see it, scroll down or tap <b>View More</b>.', pic: addRow() },
        { html: 'Leave <b>Open as Web App</b> on and tap <b>Add</b>.', pic: addScreen(true) },
      ];
    case 'ios-safari':
      return [
        { html: 'Tap the <b>Share</b> button at the bottom of Safari.', pic: safariToolbar() },
        { html: 'Scroll down and tap <b>Add to Home Screen</b>.', pic: addRow() },
        { html: 'Tap <b>Add</b>.', pic: addScreen(false) },
      ];
    case 'ios-chrome':
      return [
        { html: 'Tap the <b>Share</b> button in the address bar.', pic: chromeIosBar() },
        { html: 'Tap <b>Add to Home Screen</b> (scroll down if it’s hidden).', pic: addRow() },
        { html: 'Tap <b>Add</b>.', pic: addScreen(false) },
      ];
    case 'android':
      return [
        { html: 'Tap the <b>⋮</b> menu at the top right of Chrome.', pic: androidBar() },
        { html: 'Tap <b>Add to home screen</b> (or <b>Install app</b>), then <b>Install</b>.', pic: androidMenu() },
      ];
    default:
      return [];
  }
}

export interface HomeCardOptions {
  kind: BrowserKind;
  /** Android Chrome's own install prompt, when it has offered one: then it's a single button. */
  prompt: (() => Promise<void>) | null;
  /** She already has a game going in this browser (it doesn't move to the app by itself). */
  hasProgress: boolean;
}

/** The card's inner HTML. Buttons: #homeInstall (when there's a prompt) and #homeLater. */
export function homeCardHtml(o: HomeCardOptions): string {
  const head =
    `<div class="homeHead"><img src="icons/icon-192.png" alt="" width="48" height="48"/><h2 id="homeTitle">Add Unfill to your Home Screen</h2></div>` +
    `<p class="homeLead">It opens full screen, plays without Wi-Fi, and keeps your bottles safe.</p>`;
  const progress = o.hasProgress
    ? `<p class="homeNote">Already playing here? In the app, use <b>Settings › Move your progress</b> to bring your game along.</p>`
    : '';
  if (o.prompt) {
    return (
      head +
      `<button id="homeInstall" type="button" class="primary">Add to Home Screen</button>` +
      progress +
      `<button id="homeLater" type="button" class="homeLater">Maybe later</button>`
    );
  }
  if (o.kind === 'ios-other') {
    return (
      head +
      `<p class="homeStepText">This page is open inside another app. Open it in <b>Safari</b> first (look for <b>Open in Safari</b> or the compass in this app’s menu), then come back to this card.</p>` +
      `<button id="homeLater" type="button" class="homeLater">Play here for now</button>`
    );
  }
  const steps = stepsFor(o.kind)
    .map(
      (s, i) =>
        `<li class="homeStep"><span class="homeNum">${i + 1}</span><div><p class="homeStepText">${s.html}</p><div class="homePic">${s.pic}</div></div></li>`,
    )
    .join('');
  return (
    head +
    `<ol class="homeSteps">${steps}</ol>` +
    progress +
    `<p class="homeNote">Then open Unfill from your Home Screen.</p>` +
    `<button id="homeLater" type="button" class="homeLater">Maybe later, play here</button>`
  );
}
