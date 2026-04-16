// apps/frontend/src/api/currency.ts
import { axiosInstance } from './axiosConfig';

export interface ExchangeRatesResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
  stale: boolean;
}

export async function fetchExchangeRates(): Promise<ExchangeRatesResponse> {
  const res = await axiosInstance.get<ExchangeRatesResponse>('/api/v1/currency/rates');
  return res.data;
}