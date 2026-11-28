import { Directive } from '@angular/core';
import { AbstractControl, NG_VALIDATORS, ValidationErrors, Validator } from '@angular/forms';

const ALLOWED_PHONE_CHARS = /^\+?[\d\s().-]+$/;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normalizes a valid US (+1) phone number to E.164 format (`+1XXXXXXXXXX`).
 * Accepts 10-digit US numbers (e.g. `5551234567`, `(555) 123-4567`) or
 * 11-digit numbers with leading `1` or `+1` (e.g. `+15551234567`, `1-555-123-4567`).
 * Returns `null` if the input is not a valid US (+1) phone number.
 */
export function normalizeUsPhone(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !ALLOWED_PHONE_CHARS.test(trimmed)) {
    return null;
  }

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (hasPlus) {
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    return null;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return null;
}

/**
 * Simple client-side US (+1) phone number validation.
 */
export function isValidUsPhone(value: string | null | undefined): boolean {
  return normalizeUsPhone(value) !== null;
}

/**
 * Simple client-side email validation (`name@domain.tld`).
 */
export function isValidEmail(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!SIMPLE_EMAIL_PATTERN.test(trimmed)) {
    return false;
  }

  const [, domain] = trimmed.split('@');
  if (!domain || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return false;
  }

  return true;
}

@Directive({
  selector: '[appUsPhone]',
  standalone: true,
  providers: [
    {
      provide: NG_VALIDATORS,
      useExisting: UsPhoneValidatorDirective,
      multi: true,
    },
  ],
})
export class UsPhoneValidatorDirective implements Validator {
  validate(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }
    return isValidUsPhone(String(value)) ? null : { usPhone: true };
  }
}

@Directive({
  selector: '[appEmail]',
  standalone: true,
  providers: [
    {
      provide: NG_VALIDATORS,
      useExisting: EmailValidatorDirective,
      multi: true,
    },
  ],
})
export class EmailValidatorDirective implements Validator {
  validate(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }
    return isValidEmail(String(value)) ? null : { emailFormat: true };
  }
}
