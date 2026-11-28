import { isValidEmail, isValidUsPhone, normalizeUsPhone } from './validation.util';

describe('validation.util', () => {
  describe('US (+1) phone validation', () => {
    it('accepts valid US (+1) phone numbers in common formats', () => {
      expect(isValidUsPhone('+15551234567')).toBeTrue();
      expect(isValidUsPhone('+1 (555) 123-4567')).toBeTrue();
      expect(isValidUsPhone('+1-555-123-4567')).toBeTrue();
      expect(isValidUsPhone('15551234567')).toBeTrue();
      expect(isValidUsPhone('1 555 123 4567')).toBeTrue();
      expect(isValidUsPhone('5551234567')).toBeTrue();
      expect(isValidUsPhone('(555) 123-4567')).toBeTrue();
      expect(isValidUsPhone('555.123.4567')).toBeTrue();
    });

    it('normalizes valid US phone numbers to +1 E.164 format', () => {
      expect(normalizeUsPhone('+15551234567')).toBe('+15551234567');
      expect(normalizeUsPhone('(555) 123-4567')).toBe('+15551234567');
      expect(normalizeUsPhone('1-555-123-4567')).toBe('+15551234567');
      expect(normalizeUsPhone('  555 123 4567  ')).toBe('+15551234567');
    });

    it('rejects non-US country codes, wrong digit counts, and invalid characters', () => {
      expect(isValidUsPhone('')).toBeFalse();
      expect(isValidUsPhone('   ')).toBeFalse();
      expect(isValidUsPhone('5551234')).toBeFalse();
      expect(isValidUsPhone('+1555123456')).toBeFalse();
      expect(isValidUsPhone('+155512345678')).toBeFalse();
      expect(isValidUsPhone('+442079460958')).toBeFalse();
      expect(isValidUsPhone('+44555123456')).toBeFalse();
      expect(isValidUsPhone('25551234567')).toBeFalse();
      expect(isValidUsPhone('+1555abc4567')).toBeFalse();
      expect(normalizeUsPhone('+442079460958')).toBeNull();
    });
  });

  describe('email validation', () => {
    it('accepts valid email addresses', () => {
      expect(isValidEmail('alex@budgetapp.local')).toBeTrue();
      expect(isValidEmail('jordan@example.com')).toBeTrue();
      expect(isValidEmail('first.last+tag@sub.domain.co')).toBeTrue();
      expect(isValidEmail('  user@example.org  ')).toBeTrue();
    });

    it('rejects malformed email addresses', () => {
      expect(isValidEmail('')).toBeFalse();
      expect(isValidEmail('   ')).toBeFalse();
      expect(isValidEmail('notanemail')).toBeFalse();
      expect(isValidEmail('user@')).toBeFalse();
      expect(isValidEmail('@example.com')).toBeFalse();
      expect(isValidEmail('user@localhost')).toBeFalse();
      expect(isValidEmail('user@.example.com')).toBeFalse();
      expect(isValidEmail('user@example..com')).toBeFalse();
      expect(isValidEmail('user name@example.com')).toBeFalse();
      expect(isValidEmail('user@example.c')).toBeFalse();
    });
  });
});
