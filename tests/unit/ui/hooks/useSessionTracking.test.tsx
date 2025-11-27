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
});