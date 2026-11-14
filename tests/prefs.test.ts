import { describe, expect, it } from 'vitest';
import { SAND_HEX } from '../src/app/game/palette';
import {
  FIFTH_SAND,
  PATTERN,
  SAND_PATTERN,
  decodeProgress,
  encodeProgress,
  parsePatternMode,
  parseReducedMotion,
  patternFor,
} from '../src/app/game/prefs';

describe('color-blind patterns', () => {
  it('gives every sand its own pattern, one of them plain', () => {
    expect(SAND_PATTERN.length).toBe(SAND_HEX.length);
    expect(new Set(SAND_PATTERN).size).toBe(SAND_HEX.length);
    expect(SAND_PATTERN.filter((p) => p === PATTERN.plain).length).toBe(1);
  });

  it('patterns only the fifth sand by default, all of them on "all", none on "off"', () => {
    expect(parsePatternMode(null)).toBe('fifth');
    expect(parsePatternMode('nonsense')).toBe('fifth');
    for (let k = 0; k < 5; k++) {
      expect(patternFor(k, 'off')).toBe(PATTERN.plain);
      expect(patternFor(k, 'all')).toBe(SAND_PATTERN[k]);
      expect(patternFor(k, 'fifth') !== PATTERN.plain).toBe(k === FIFTH_SAND);
    }
    expect(patternFor(FIFTH_SAND, 'fifth')).not.toBe(PATTERN.plain);
  });
});

describe('reduced motion', () => {
  it("follows the device until she chooses", () => {
    expect(parseReducedMotion(null, true)).toBe(true);
    expect(parseReducedMotion(null, false)).toBe(false);
    expect(parseReducedMotion('0', true)).toBe(false);
    expect(parseReducedMotion('1', false)).toBe(true);
  });
});

describe('progress codes', () => {
  const progress = {
    save: { v: 1, n: 7, taps: [3, 1, 4], note: 'ünïcødé ✓' },
    shelf: [{ n: 1, layers: [0, 1, 2], stars: 3 }],
    best: 1234,
  };

  it('round-trips the save, the shelf and the high score', () => {
    const code = encodeProgress(progress);
    expect(code.startsWith('UNFILL1:')).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9:_-]+$/); // safe to paste anywhere
    expect(decodeProgress(code)).toEqual(progress);
  });

  it('ignores whitespace and line breaks a message app might add', () => {
    const code = encodeProgress(progress);
    const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20, 50)} \n${code.slice(50)}\n`;
    expect(decodeProgress(wrapped)).toEqual(progress);
  });

  it('rejects anything that is not a whole code', () => {
    const code = encodeProgress(progress);
    expect(decodeProgress('')).toBeNull();
    expect(decodeProgress('hello')).toBeNull();
    expect(decodeProgress(code.slice(0, code.length - 10))).toBeNull();
    expect(decodeProgress('UNFILL1:' + btoa('{"v":2,"shelf":[],"best":0}'))).toBeNull();
    expect(decodeProgress('UNFILL1:' + btoa('{"v":1,"shelf":{},"best":0}'))).toBeNull();
    expect(decodeProgress('UNFILL1:' + btoa('{"v":1,"shelf":[],"best":-5}'))).toBeNull();
  });
});
