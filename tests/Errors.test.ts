import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthorizationError,
  ProviderError,
  MonitoringError,
  ConfigurationError,
} from '../src/errors';

describe('Error Classes', () => {
  describe('AppError', () => {
    it('creates error with message, code, and status code', () => {
      const err = new AppError('test error', 'TEST_CODE', 400);
      expect(err.message).toBe('test error');
      expect(err.code).toBe('TEST_CODE');
      expect(err.statusCode).toBe(400);
      expect(err.name).toBe('AppError');
    });

    it('defaults to 500 status code', () => {
      const err = new AppError('test', 'TEST');
      expect(err.statusCode).toBe(500);
    });
  });

  describe('ValidationError', () => {
    it('creates validation error with 400 status', () => {
      const err = new ValidationError('Invalid input');
      expect(err.message).toBe('Invalid input');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.statusCode).toBe(400);
      expect(err.name).toBe('ValidationError');
    });
  });

  describe('AuthorizationError', () => {
    it('creates authorization error with 403 status', () => {
      const err = new AuthorizationError('Access denied');
      expect(err.message).toBe('Access denied');
      expect(err.code).toBe('AUTHORIZATION_ERROR');
      expect(err.statusCode).toBe(403);
      expect(err.name).toBe('AuthorizationError');
    });
  });

  describe('ProviderError', () => {
    it('creates provider error with 502 status', () => {
      const err = new ProviderError('AWS timeout');
      expect(err.message).toBe('AWS timeout');
      expect(err.code).toBe('PROVIDER_ERROR');
      expect(err.statusCode).toBe(502);
      expect(err.name).toBe('ProviderError');
    });

    it('optionally accepts provider name', () => {
      const err = new ProviderError('timeout', 'AWS');
      expect(err.provider).toBe('AWS');
    });
  });

  describe('MonitoringError', () => {
    it('creates monitoring error with 500 status', () => {
      const err = new MonitoringError('KV read failed');
      expect(err.message).toBe('KV read failed');
      expect(err.code).toBe('MONITORING_ERROR');
      expect(err.statusCode).toBe(500);
      expect(err.name).toBe('MonitoringError');
    });
  });

  describe('ConfigurationError', () => {
    it('creates configuration error with 500 status', () => {
      const err = new ConfigurationError('Missing binding');
      expect(err.message).toBe('Missing binding');
      expect(err.code).toBe('CONFIGURATION_ERROR');
      expect(err.statusCode).toBe(500);
      expect(err.name).toBe('ConfigurationError');
    });
  });

  describe('instanceof checks', () => {
    it('ValidationError is instance of AppError', () => {
      expect(new ValidationError('test')).toBeInstanceOf(AppError);
    });

    it('ProviderError is instance of AppError', () => {
      expect(new ProviderError('test')).toBeInstanceOf(AppError);
    });

    it('AppError is instance of Error', () => {
      expect(new AppError('test', 'T')).toBeInstanceOf(Error);
    });
  });
});
