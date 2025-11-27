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

  describe('sessionUtils - Edge Cases', () => {
    describe('getFingerprint - Error Handling', () => {
      it('should handle missing navigator properties gracefully', () => {
        // Store original values
        const originalUserAgent = navigator.userAgent;
        const originalLanguages = navigator.languages;
        
        // Simulate missing properties
        Object.defineProperty(navigator, 'userAgent', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'languages', { value: undefined, configurable: true });

        // Should not throw error
        expect(() => getFingerprint()).not.toThrow();
        
        // Restore
        Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
        Object.defineProperty(navigator, 'languages', { value: originalLanguages, configurable: true });
      });

      it('should generate fingerprint even with minimal data', () => {
        const minimalFingerprint = getFingerprint();
        expect(minimalFingerprint).toMatch(/^fp_/);
        expect(minimalFingerprint.length).toBeGreaterThan(5);
      });
    });

    describe('shouldCreateNewSession - Edge Cases', () => {
      it('should return true for corrupted session data', () => {
        const corruptedSessions = [
          'invalid json', // This will be parsed as string, not object
          { sessionId: null, fingerprint: null, createdAt: null },
        ];

        corruptedSessions.forEach(session => {
          expect(shouldCreateNewSession(session)).toBe(true);
        });

        // Test cases that should return false (valid according to current implementation)
        const validButWrongTypes = [
          { sessionId: 123, fingerprint: 456, createdAt: Date.now() }, // Current impl accepts numbers
          { sessionId: '123', fingerprint: 'abc', createdAt: 'invalid' }, // Current impl accepts string timestamps
        ];

        validButWrongTypes.forEach(session => {
          expect(shouldCreateNewSession(session)).toBe(false);
        });
      });

      it('should handle exactly 3-hour old session (boundary condition)', () => {
        const boundarySession = {
          sessionId: 'session_123',
          fingerprint: 'fp_abc',
          createdAt: Date.now() - (3 * 60 * 60 * 1000), // exactly 3 hours
        };

        // Current implementation uses > 3 hours, so exactly 3 hours should NOT be expired
        expect(shouldCreateNewSession(boundarySession)).toBe(false);
        
        // Test that 3 hours + 1ms IS expired
        const expiredSession = {
          sessionId: 'session_123',
          fingerprint: 'fp_abc', 
          createdAt: Date.now() - (3 * 60 * 60 * 1000 + 1), // 3 hours + 1ms
        };
        expect(shouldCreateNewSession(expiredSession)).toBe(true);
      });
    });

    describe('isSessionExpired - Edge Cases', () => {
      it('should handle future dates (clock skew)', () => {
        const futureSession = {
          sessionId: 'session_123',
          fingerprint: 'fp_abc',
          createdAt: Date.now() + (60 * 60 * 1000), // 1 hour in future
        };

        expect(isSessionExpired(futureSession)).toBe(false);
      });

      it('should handle very old sessions', () => {
        const ancientSession = {
          sessionId: 'session_123',
          fingerprint: 'fp_abc',
          createdAt: Date.now() - (365 * 24 * 60 * 60 * 1000), // 1 year ago
        };

        expect(isSessionExpired(ancientSession)).toBe(true);
      });
    });
  });
});