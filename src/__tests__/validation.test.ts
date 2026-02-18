// src/__tests__/validation.test.ts

import { describe, it, expect } from 'vitest';
import {
  validateAmount,
  validateNpub,
  validateCreateParams,
  ValidationError
} from '../utils/validation';

describe('Validation', () => {
  describe('validateAmount', () => {
    it('should reject amounts below minimum', () => {
      expect(() => validateAmount(500)).toThrow(ValidationError);
    });

    it('should reject negative amounts', () => {
      expect(() => validateAmount(-1000)).toThrow(ValidationError);
    });

    it('should accept valid amounts', () => {
      expect(() => validateAmount(50000)).not.toThrow();
    });
  });

  describe('validateNpub', () => {
    it('should reject empty npub', () => {
      expect(() => validateNpub('', 'test')).toThrow('required');
    });

    it('should reject invalid format', () => {
      expect(() => validateNpub('invalid', 'test')).toThrow('Invalid');
    });

    it('should accept valid npub', () => {
      const validNpub = 'npub1' + 'x'.repeat(58);
      expect(() => validateNpub(validNpub, 'test')).not.toThrow();
    });
  });
});
