import { describe, expect, it } from 'vitest';
import { isOverlayEnabled } from '../src/flags';

describe('isOverlayEnabled', () => {
  it('is on by default in development', () => {
    expect(isOverlayEnabled({})).toBe(true);
    expect(isOverlayEnabled({ search: '?foo=1' })).toBe(true);
  });

  it('is off when the enabled prop is false', () => {
    expect(isOverlayEnabled({ enabled: false })).toBe(false);
    expect(isOverlayEnabled({ enabled: false, search: '?redline=1' })).toBe(false);
  });

  it('is off when the plugin reports enabled: false', () => {
    expect(isOverlayEnabled({ serverEnabled: false })).toBe(false);
  });

  it('is off with ?redline=0', () => {
    expect(isOverlayEnabled({ search: '?redline=0' })).toBe(false);
    expect(isOverlayEnabled({ search: '?a=b&redline=off' })).toBe(false);
  });

  it('is off when the user prefers reduced motion', () => {
    expect(isOverlayEnabled({ reducedMotion: true })).toBe(false);
    expect(isOverlayEnabled({ reducedMotion: true, search: '?redline=1' })).toBe(false);
  });

  it('can ignore reduced motion when asked', () => {
    expect(isOverlayEnabled({ reducedMotion: true, respectReducedMotion: false })).toBe(true);
  });

  it('is off when localStorage.redlineDisabled is "1", unless ?redline=1', () => {
    expect(isOverlayEnabled({ storageDisabled: '1' })).toBe(false);
    expect(isOverlayEnabled({ storageDisabled: '0' })).toBe(true);
    expect(isOverlayEnabled({ storageDisabled: '1', search: '?redline=1' })).toBe(true);
  });

  it('is off in production unless explicitly enabled', () => {
    expect(isOverlayEnabled({ production: true })).toBe(false);
    expect(isOverlayEnabled({ production: true, enabled: true })).toBe(true);
  });
});
