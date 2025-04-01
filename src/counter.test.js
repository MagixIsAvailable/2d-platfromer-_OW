// src/counter.test.js
import { describe, it, expect } from 'vitest';

describe('Counter', () => {
  it('should add numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should subtract numbers correctly', () => {
    expect(5 - 3).toBe(2);
  });

  it('should multiply numbers correctly', () => {
    expect(2 * 3).toBe(6);
  });
});