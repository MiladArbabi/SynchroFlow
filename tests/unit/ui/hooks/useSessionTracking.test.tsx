// tests/unit/ui/hooks/useSessionTracking.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useSessionTracking } from 'hooks/useSessionTracking';

// ✅ CORRECT: Define everything inside factory
jest.mock('utils/sessionUtils', () => {
  const mockGenerateSessionId = jest.fn();
  const mockGetFingerprint = jest.fn();
  
  return {
    generateSessionId: mockGenerateSessionId,
    getFingerprint: mockGetFingerprint,
    shouldCreateNewSession: jest.fn(),
    isSessionExpired: jest.fn(),
  };
});

// ✅ CORRECT: Define everything inside factory
jest.mock('api/user-state', () => {
  const mockSaveSessionData = jest.fn();
  
  return {
    saveSessionData: mockSaveSessionData,
  };
});

describe('useSessionTracking', () => {
  const mockSessionUtils = require('utils/sessionUtils');
  const mockUserState = require('api/user-state');
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear localStorage properly
    localStorage.clear();
    
    // Restore default mock implementations
    mockSessionUtils.generateSessionId.mockReturnValue('session-123');
    mockSessionUtils.getFingerprint.mockReturnValue('fingerprint-abc');
    mockSessionUtils.shouldCreateNewSession.mockImplementation((session: any) => !session || !session.sessionId);
    mockSessionUtils.isSessionExpired.mockReturnValue(false);
  });

  afterEach(() => {
    // Restore localStorage if it was mocked
    if ((window as any).localStorage._restore) {
      (window as any).localStorage._restore();
    }
  });

  it('should initialize session with new ID when no session exists', () => {
    const { result } = renderHook(() => useSessionTracking());

    expect(result.current.sessionId).toBe('session-123');
    expect(result.current.fingerprint).toBe('fingerprint-abc');
  });

  it('should restore existing session from localStorage', () => {
    const existingSession = {
      sessionId: 'existing-session-456',
      fingerprint: 'existing-fingerprint-def',
      createdAt: Date.now() - 1000,
    };
    localStorage.setItem('specter_session', JSON.stringify(existingSession));

    // Mock shouldCreateNewSession to return false for existing session
    mockSessionUtils.shouldCreateNewSession.mockReturnValue(false);

    const { result } = renderHook(() => useSessionTracking());

    expect(result.current.sessionId).toBe('existing-session-456');
    expect(result.current.fingerprint).toBe('existing-fingerprint-def');
  });

  it('should handle localStorage errors gracefully and fallback to memory', () => {
    // Mock localStorage.getItem to throw error but keep other methods
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = jest.fn(() => { 
      throw new Error('Storage failed'); 
    });

    mockSessionUtils.generateSessionId.mockReturnValue('fallback-session-789');
    mockSessionUtils.getFingerprint.mockReturnValue('fallback-fingerprint-ghi');

    const { result } = renderHook(() => useSessionTracking());

    expect(result.current.sessionId).toBe('fallback-session-789');
    expect(result.current.fingerprint).toBe('fallback-fingerprint-ghi');
    
    // Restore original getItem
    localStorage.getItem = originalGetItem;
  });

  it('should track page views and update session data', () => {
    const { result } = renderHook(() => useSessionTracking());

    act(() => {
      result.current.trackPageView('/products');
    });

    expect(result.current.pageViews).toContainEqual({
      path: '/products',
      timestamp: expect.any(Number),
    });
  });

  it('should detect returning visitors by fingerprint', () => {
    const firstFingerprint = 'fingerprint-abc';
    mockSessionUtils.getFingerprint.mockReturnValue(firstFingerprint);

    // First render - new visitor
    renderHook(() => useSessionTracking());
    
    // Store the fingerprint to simulate returning visitor
    localStorage.setItem('specter_known_fingerprints', JSON.stringify([firstFingerprint]));
    
    // Simulate new session with same fingerprint
    mockSessionUtils.generateSessionId.mockReturnValue('new-session-456');
    
    // Second render - returning visitor
    const { result: secondResult } = renderHook(() => useSessionTracking());

    expect(secondResult.current.isReturningVisitor).toBe(true);
  });

  it('should persist session data to user-state API', async () => {
    mockUserState.saveSessionData.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useSessionTracking());

    await act(async () => {
      await result.current.persistSession();
    });

    expect(mockUserState.saveSessionData).toHaveBeenCalledWith({
      sessionId: 'session-123',
      fingerprint: 'fingerprint-abc',
      pageViews: [],
      createdAt: expect.any(Number),
      lastActivityAt: expect.any(Number),
    });
  });

  describe('useSessionTracking - Edge Cases', () => {
    it('should handle API failure in persistSession gracefully', async () => {
      mockUserState.saveSessionData.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSessionTracking());

      // Should not throw error
      await expect(result.current.persistSession()).resolves.not.toThrow();
      expect(mockUserState.saveSessionData).toHaveBeenCalled();
    });

    it('should handle corrupted session data in localStorage', () => {
      localStorage.setItem('specter_session', 'invalid json data');
      
      const { result } = renderHook(() => useSessionTracking());

      // Should create new session despite corruption
      expect(result.current.sessionId).toBe('session-123');
      expect(result.current.fingerprint).toBe('fingerprint-abc');
    });

    it('should handle multiple page views correctly', () => {
      const { result } = renderHook(() => useSessionTracking());

      act(() => {
        result.current.trackPageView('/products');
        result.current.trackPageView('/cart');
        result.current.trackPageView('/checkout');
      });

      expect(result.current.pageViews).toHaveLength(3);
      expect(result.current.pageViews[0].path).toBe('/products');
      expect(result.current.pageViews[2].path).toBe('/checkout');
    });

    it('should handle very large session data without performance issues', () => {
      // Create session with many page views
      const largeSession = {
        sessionId: 'large-session',
        fingerprint: 'fp-large',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        pageViews: Array.from({ length: 1000 }, (_, i) => ({
          path: `/page/${i}`,
          timestamp: Date.now() + i,
        })),
      };

      localStorage.setItem('specter_session', JSON.stringify(largeSession));
      mockSessionUtils.shouldCreateNewSession.mockReturnValue(false);

      const { result } = renderHook(() => useSessionTracking());

      // Should still work with large data
      expect(result.current.sessionId).toBe('large-session');
      expect(result.current.pageViews).toHaveLength(1000);
    });

    it('should handle concurrent session updates', async () => {
      const { result } = renderHook(() => useSessionTracking());

      // Simulate multiple rapid updates
      await act(async () => {
        const promises = [
          result.current.trackPageView('/page1'),
          result.current.trackPageView('/page2'),
          result.current.persistSession(),
        ];
        await Promise.all(promises);
      });

      // Should handle concurrency without errors
      expect(result.current.pageViews.length).toBeGreaterThanOrEqual(2);
    });

    it('should maintain session across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useSessionTracking());
      
      // Second instance should use same session
      const { result: result2 } = renderHook(() => useSessionTracking());

      expect(result1.current.sessionId).toBe(result2.current.sessionId);
      expect(result1.current.fingerprint).toBe(result2.current.fingerprint);
    });

    it('should handle fingerprint collisions gracefully', () => {
      // Simulate different sessions with same fingerprint
      const session1 = {
        sessionId: 'session-1',
        fingerprint: 'collision-fp',
        createdAt: Date.now() - 1000,
      };
      
      localStorage.setItem('specter_session', JSON.stringify(session1));
      localStorage.setItem('specter_known_fingerprints', JSON.stringify(['collision-fp']));

      mockSessionUtils.shouldCreateNewSession.mockReturnValue(false);
      mockSessionUtils.getFingerprint.mockReturnValue('collision-fp');

      const { result } = renderHook(() => useSessionTracking());

      // Should handle collision and still work
      expect(result.current.sessionId).toBe('session-1');
      expect(result.current.isReturningVisitor).toBe(true);
    });
  });
});