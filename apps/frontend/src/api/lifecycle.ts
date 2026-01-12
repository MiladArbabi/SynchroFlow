//apps/frontend/src/api/lifecycle.ts

import { axiosInstance } from './axiosConfig';

export async function getLifecycle() {
  const { data } = await axiosInstance.get('/api/v1/lifecycle');
  return data; // { phase }
}

/**
 * confirmFt1
 * ----------
 * Explicit FT0 → FT1 lifecycle confirmation.
 *
 * HARD RULES:
 * - User initiated only
 * - No inference
 * - Backend authoritative
 */

export async function confirmFt1() {
  return axiosInstance.post('/api/v1/lifecycle/ft1/confirm');
}

export async function evaluateFt2() {
  const { data } = await axiosInstance.get('/api/v1/lifecycle/ft2/evaluate');
  return data;
}

export async function confirmFt2() {
  const { data } = await axiosInstance.post('/api/v1/lifecycle/ft2/confirm');
  return data;
}
