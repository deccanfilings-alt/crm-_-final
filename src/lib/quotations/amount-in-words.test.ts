import { describe, it, expect } from 'vitest';
import { numberToWordsINR } from './amount-in-words';

describe('numberToWordsINR', () => {
  it('converts basic numbers', () => {
    expect(numberToWordsINR(0)).toBe('Zero Rupees Only');
    expect(numberToWordsINR(500)).toBe('Five Hundred Rupees Only');
    expect(numberToWordsINR(1250)).toBe('One Thousand Two Hundred Fifty Rupees Only');
  });

  it('converts lakhs and thousands', () => {
    expect(numberToWordsINR(25000)).toBe('Twenty Five Thousand Rupees Only');
    expect(numberToWordsINR(150000)).toBe('One Lakh Fifty Thousand Rupees Only');
    expect(numberToWordsINR(1234567)).toBe('Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only');
  });

  it('converts crores', () => {
    expect(numberToWordsINR(10000000)).toBe('One Crore Rupees Only');
  });
});
