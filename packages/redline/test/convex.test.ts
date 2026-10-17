import { describe, expect, it } from 'vitest';
import { convexImportArgs } from '../src/convex';

describe('convexImportArgs', () => {
  it('adds --yes when stdin is not a TTY', () => {
    expect(convexImportArgs('s.zip', { tty: false })).toEqual(['import', '--yes', 's.zip']);
  });

  it('leaves --yes out on a TTY without flags; restore asks first and then passes yes', () => {
    expect(convexImportArgs('s.zip', { tty: true })).toEqual(['import', 's.zip']);
    expect(convexImportArgs('s.zip', { tty: true, yes: true })).toEqual(['import', '--yes', 's.zip']);
  });

  it('adds --yes with --replace, and keeps --replace', () => {
    expect(convexImportArgs('s.zip', { tty: true, replace: true })).toEqual(['import', '--replace', '--yes', 's.zip']);
  });
});
