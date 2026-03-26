//apps/frontend/src/api/lifecycle.ts

import { axiosInstance } from './axiosConfig';

export async function getLifecycle() {
  const { data } = await axiosInstance.get('/api/v1/lifecycle');
  return data; // { phase }
}

export async function evaluateFt2() {
  /**
   * ⚠️ DEBUG ONLY — DO NOT USE IN PRODUCTION
   *
   * This endpoint exposes full eligibility logic and MUST NOT be used
   * for UI readiness or gating.
   *
   * Use getFt2Readiness() instead.
   */
  const { data } = await axiosInstance.get('/api/v1/lifecycle/ft2/evaluate');
  return data;
}

/**
 * FT2 Readiness — PRODUCTION CONTRACT
 * -----------------------------------
 * Must be used for UI gating instead of evaluateFt2.
 */
export async function getFt2Readiness() {
  const { data } = await axiosInstance.get('/api/v1/lifecycle/ft2/readiness');
  return data; // { ready, progress }
}

export async function confirmFt2() {
  const { data } = await axiosInstance.post('/api/v1/lifecycle/ft2/confirm');
  return data;
}
