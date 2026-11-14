import { describe, expect, it } from 'vitest';
import { browserKind, homeCardHtml, stepsFor } from '../src/app/game/homecard';

const IOS18 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// iOS 26 Safari keeps "OS 18_6" in the UA but reports its own version
const IOS26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const FB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0]';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

describe('Add to Home Screen card', () => {
  it('tells the browsers apart', () => {
    expect(browserKind(IOS18)).toBe('ios-safari');
    expect(browserKind(IOS26)).toBe('ios-safari-26');
    expect(browserKind(CHROME_IOS)).toBe('ios-chrome');
    expect(browserKind(FB)).toBe('ios-other');
    expect(browserKind(ANDROID)).toBe('android');
    expect(browserKind(IPAD, 5, 'MacIntel')).toBe('ios-safari-26');
    expect(browserKind(IPAD, 0, 'MacIntel')).toBe('other');
  });

  it('shows the right steps, or one button when Android offers its prompt', () => {
    expect(stepsFor('ios-safari-26').map((s) => s.html)).toEqual([
      expect.stringContaining('•••'),
      expect.stringContaining('Share'),
      expect.stringContaining('Add to Home Screen'),
      expect.stringContaining('Open as Web App'),
    ]);
    expect(stepsFor('ios-safari')).toHaveLength(3);
    const steps = homeCardHtml({ kind: 'ios-safari', prompt: null, hasProgress: true });
    expect(steps).toContain('homeSteps');
    expect(steps).toContain('Move your progress');
    expect(steps).not.toContain('homeInstall');
    const one = homeCardHtml({ kind: 'android', prompt: async () => {}, hasProgress: false });
    expect(one).toContain('id="homeInstall"');
    expect(one).not.toContain('homeSteps');
    expect(homeCardHtml({ kind: 'ios-other', prompt: null, hasProgress: false })).toContain('Safari');
  });
});
