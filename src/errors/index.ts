export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string) {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

export class ProviderError extends AppError {
  public readonly provider?: string;

  constructor(message: string, provider?: string) {
    super(message, 'PROVIDER_ERROR', 502);
    this.name = 'ProviderError';
    this.provider = provider;
  }
}

export class MonitoringError extends AppError {
  constructor(message: string) {
    super(message, 'MONITORING_ERROR', 500);
    this.name = 'MonitoringError';
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}
