import { describe, it, expect } from 'vitest';
import { counterFunction } from './counter'; // Adjust the import based on your actual counter function location

describe('Counter Functionality', () => {
    it('should increment the counter', () => {
        expect(counterFunction(0, 'increment')).toBe(1);
    });

    it('should decrement the counter', () => {
        expect(counterFunction(1, 'decrement')).toBe(0);
    });

    it('should return the same value for unknown action', () => {
        expect(counterFunction(1, 'unknown')).toBe(1);
    });
});