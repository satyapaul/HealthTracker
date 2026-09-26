import { describe, it, expect } from 'vitest';
import { apiVersion } from './index';

describe('api scaffold', () => {
  it('exposes a version', () => {
    expect(apiVersion).toBe('0.1.0');
  });
});
