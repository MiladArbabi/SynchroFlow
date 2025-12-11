//tests/unit/api/config/env-validation.test.ts
import { validateEnvironment } from "api-src/config/env";

describe('Environment Validation', () => {
  beforeEach(() => {
    // Reset process.env for each test
    delete process.env.JWT_SECRET;
    delete process.env.PGHOST;
    delete process.env.API_URL;
  });

  it('should throw error when JWT_SECRET is missing', () => {
    // Arrange
    process.env.PGHOST = 'localhost';
    process.env.API_URL = 'http://localhost:3000';

    // Act & Assert
    expect(() => validateEnvironment()).toThrow(
      'Missing required environment variable: JWT_SECRET'
    );
  });

  it('should throw error when PGHOST is missing', () => {
    // Arrange
    process.env.JWT_SECRET = 'test-secret';
    process.env.API_URL = 'http://localhost:3000';

    // Act & Assert
    expect(() => validateEnvironment()).toThrow(
      'Missing required environment variable: PGHOST'
    );
  });

  it('should validate URL format for API_URL', () => {
    // Arrange
    process.env.JWT_SECRET = 'test-secret';
    process.env.PGHOST = 'localhost';
    process.env.API_URL = 'not-a-valid-url';

    // Act & Assert
    expect(() => validateEnvironment()).toThrow(
      'Invalid URL format for API_URL: not-a-valid-url'
    );
  });

  it('should not throw when all required variables are present and valid', () => {
    // Arrange
    process.env.JWT_SECRET = 'test-secret';
    process.env.PGHOST = 'localhost';
    process.env.API_URL = 'http://localhost:3000';
    process.env.FRONTEND_URL = 'http://localhost:5173';
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    process.env.PGPORT = '5432';
    process.env.PGUSER = 'test-user';
    process.env.PGPASSWORD = 'test-password';
    process.env.PGDATABASE = 'test-db';
    process.env.RABBITMQ_URL = 'amqp://localhost';

    // Act & Assert
    expect(() => validateEnvironment()).not.toThrow();
  });
});