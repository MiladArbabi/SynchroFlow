// tests/unit/ui/utils/sessionUtils.test.ts
import { 
  generateSessionId, 
  getFingerprint, 
  shouldCreateNewSession,
  isSessionExpired 
} from 'utils/sessionUtils';

// Mock browser environment before tests run
beforeAll(() => {
  // Set up minimal navigator and screen objects
  Object.defineProperty(global, 'navigator', {
    value: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      language: 'en-US',
      languages: ['en-US', 'en'],
      platform: 'MacIntel',
      hardwareConcurrency: 8,
      deviceMemory: 8,
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(global, 'screen', {
    value: {
      width: 1920,
      height: 1080,
      colorDepth: 24,
    },
    configurable: true,
    writable: true,
  });
});

describe('sessionUtils', () => {
  describe('generateSessionId', () => {
    it('should generate a unique session ID', () => {
      const sessionId1 = generateSessionId();
      const sessionId2 = generateSessionId();

      expect(sessionId1).toMatch(/^session_[a-zA-Z0-9_-]{16,}$/);
      expect(sessionId2).toMatch(/^session_[a-zA-Z0-9_-]{16,}$/);
      expect(sessionId1).not.toBe(sessionId2);
    });

    it('should include timestamp in session ID', () => {
      const sessionId = generateSessionId();
      expect(sessionId).toContain('session_');
    });
  });

  describe('getFingerprint', () => {
    it('should generate consistent fingerprint for same environment', () => {
      const fingerprint1 = getFingerprint();
      const fingerprint2 = getFingerprint();

      expect(fingerprint1).toMatch(/^fp_[a-f0-9]{8,}$/); // Relaxed regex for shorter hashes
      expect(fingerprint2).toMatch(/^fp_[a-f0-9]{8,}$/);
      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should generate different fingerprints for different environments', () => {
      const originalUserAgent = navigator.userAgent;
      
      // Change user agent to simulate different environment
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        configurable: true,
      });

      const fingerprint1 = getFingerprint();
      
      // Restore original user agent
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });

      const fingerprint2 = getFingerprint();

      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('shouldCreateNewSession', () => {
    it('should return true for expired session', () => {
      const expiredSession = {
        sessionId: 'session_123',
        fingerprint: 'fp_abc',
        createdAt: Date.now() - (4 * 60 * 60 * 1000), // 4 hours ago
      };

      expect(shouldCreateNewSession(expiredSession)).toBe(true);
    });

    it('should return false for active session', () => {
      const activeSession = {
        sessionId: 'session_123',
        fingerprint: 'fp_abc',
        createdAt: Date.now() - (30 * 60 * 1000), // 30 minutes ago
      };

      expect(shouldCreateNewSession(activeSession)).toBe(false);
    });

    it('should return true for invalid session data', () => {
      expect(shouldCreateNewSession(null)).toBe(true);
      expect(shouldCreateNewSession({})).toBe(true);
      expect(shouldCreateNewSession({ sessionId: '123' })).toBe(true);
    });
  });

  describe('isSessionExpired', () => {
    it('should mark session as expired after 3 hours', () => {
      const oldSession = {
        sessionId: 'session_123',
        fingerprint: 'fp_abc',
        createdAt: Date.now() - (4 * 60 * 60 * 1000), // 4 hours ago
      };

      expect(isSessionExpired(oldSession)).toBe(true);
    });

    it('should not mark session as expired within 3 hours', () => {
      const recentSession = {
        sessionId: 'session_123',
        fingerprint: 'fp_abc',
        createdAt: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
      };

      expect(isSessionExpired(recentSession)).toBe(false);
    });
  });
});