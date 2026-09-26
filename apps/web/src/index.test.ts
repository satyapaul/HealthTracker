import { describe, it, expect } from 'vitest';
import { webVersion } from './index';

describe('web scaffold', () => {
  it('exposes a version', () => {
    expect(webVersion).toBe('0.1.0');
  });
});
