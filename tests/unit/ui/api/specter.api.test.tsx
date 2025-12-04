// tests/unit/ui/api/specter.api.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import {
  fetchSpecterConfig,
  upsertSpecterConfig,
  SpecterConfigShape,
} from 'api/specter';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Specter API client', () => {
  const ACCESS_TOKEN = 'test-access-token';
  const INVALID_TOKEN = 'invalid-token';
  
  // Test data
  const sampleConfig: SpecterConfigShape = {
    businessStage: 'growth',
    focusAreas: ['cash-flow', 'inventory'],
    aiAssistsEnabled: true,
    customField: 'custom-value'
  };

  const sampleResponse = {
    shopId: 42,
    config: sampleConfig
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('fetchSpecterConfig', () => {
    it('happy path - successful fetch with complete data', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: sampleResponse
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        '/api/v1/specter/config',
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          },
        }
      );
      expect(result).toEqual(sampleResponse);
    });

    it('normalizes missing fields to null', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {}
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: null,
        config: null,
      });
    });

    it('handles partial config data', async () => {
      const partialConfig: SpecterConfigShape = { businessStage: 'survival' };
      mockedAxios.get.mockResolvedValueOnce({
        data: { shopId: 42, config: partialConfig }
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: 42,
        config: partialConfig,
      });
    });

    it('handles config with empty object', async () => {
      const emptyConfig: SpecterConfigShape = {};
      mockedAxios.get.mockResolvedValueOnce({
        data: { shopId: 42, config: emptyConfig }
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: 42,
        config: emptyConfig,
      });
    });

    it('handles null config in response', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { shopId: 42, config: null }
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: 42,
        config: null,
      });
    });

    it('handles non-numeric shopId', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { shopId: '42', config: sampleConfig } // string instead of number
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: null, // Should be null because typeof !== 'number'
        config: sampleConfig,
      });
    });

    it('handles non-object config', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { shopId: 42, config: 'not-an-object' }
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: 42,
        config: null, // Should be null because config is not an object
      });
    });

    it('handles axios error with response', async () => {
      const errorResponse = {
        response: {
          status: 401,
          data: { message: 'Unauthorized' }
        }
      };
      mockedAxios.get.mockRejectedValueOnce(errorResponse);

      await expect(fetchSpecterConfig(INVALID_TOKEN)).rejects.toEqual(
        errorResponse
      );
    });

    it('handles axios error without response', async () => {
      const networkError = new Error('Network Error');
      mockedAxios.get.mockRejectedValueOnce(networkError);

      await expect(fetchSpecterConfig(ACCESS_TOKEN)).rejects.toThrow(
        'Network Error'
      );
    });

    it('handles malformed response data', async () => {
      // Axios returns data but it's not an object
      mockedAxios.get.mockResolvedValueOnce({
        data: null
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: null,
        config: null,
      });
    });

    it('handles undefined response', async () => {
      // Change from returning undefined to a proper response
      mockedAxios.get.mockResolvedValueOnce({
        data: undefined
      } as any);

      const result = await fetchSpecterConfig(ACCESS_TOKEN);

      expect(result).toEqual({
        shopId: null,
        config: null,
      });
    });
  });

  describe('upsertSpecterConfig', () => {
    it('happy path - successful upsert', async () => {
      mockedAxios.put.mockResolvedValueOnce({
        data: sampleResponse
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, sampleConfig);

      expect(mockedAxios.put).toHaveBeenCalledWith(
        '/api/v1/specter/config',
        { config: sampleConfig },
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          },
        }
      );
      expect(result).toEqual(sampleResponse);
    });

    it('handles empty config object', async () => {
      const emptyConfig: SpecterConfigShape = {};
      mockedAxios.put.mockResolvedValueOnce({
        data: { shopId: 42, config: emptyConfig }
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, emptyConfig);

      expect(result).toEqual({
        shopId: 42,
        config: emptyConfig,
      });
    });

    it('handles config with only custom properties', async () => {
      const customConfig: SpecterConfigShape = { customField: 'value', anotherField: 123 };
      mockedAxios.put.mockResolvedValueOnce({
        data: { shopId: 42, config: customConfig }
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, customConfig);

      expect(result).toEqual({
        shopId: 42,
        config: customConfig,
      });
    });

    it('handles response with missing shopId', async () => {
      mockedAxios.put.mockResolvedValueOnce({
        data: { config: sampleConfig } // No shopId
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, sampleConfig);

      expect(result).toEqual({
        shopId: null,
        config: sampleConfig,
      });
    });

    it('handles response with missing config', async () => {
      mockedAxios.put.mockResolvedValueOnce({
        data: { shopId: 42 } // No config
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, sampleConfig);

      expect(result).toEqual({
        shopId: 42,
        config: null,
      });
    });

    it('handles partial update response', async () => {
      const partialUpdate: SpecterConfigShape = { businessStage: 'architect' };
      const responseConfig: SpecterConfigShape = { ...sampleConfig, businessStage: 'architect' };
      
      mockedAxios.put.mockResolvedValueOnce({
        data: { shopId: 42, config: responseConfig }
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, partialUpdate);

      expect(result.config).toMatchObject(responseConfig);
    });

    it('handles axios error on upsert', async () => {
      const errorResponse = {
        response: {
          status: 400,
          data: { message: 'Bad Request', errors: ['Invalid businessStage'] }
        }
      };
      mockedAxios.put.mockRejectedValueOnce(errorResponse);

      await expect(upsertSpecterConfig(ACCESS_TOKEN, sampleConfig)).rejects.toEqual(
        errorResponse
      );
    });

    it('handles network timeout on upsert', async () => {
      const timeoutError = new Error('timeout of 5000ms exceeded');
      mockedAxios.put.mockRejectedValueOnce(timeoutError);

      await expect(upsertSpecterConfig(ACCESS_TOKEN, sampleConfig)).rejects.toThrow(
        'timeout of 5000ms exceeded'
      );
    });

    it('handles malformed response from upsert', async () => {
      // Response data is not an object
      mockedAxios.put.mockResolvedValueOnce({
        data: 'invalid-response'
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, sampleConfig);

      expect(result).toEqual({
        shopId: null,
        config: null,
      });
    });

    it('handles undefined response from upsert', async () => {
      // Change from returning undefined to a proper response
      mockedAxios.put.mockResolvedValueOnce({
        data: undefined
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, sampleConfig);

      expect(result).toEqual({
        shopId: null,
        config: null,
      });
    });

    it('verifies request payload structure', async () => {
      mockedAxios.put.mockResolvedValueOnce({
        data: sampleResponse
      } as any);

      await upsertSpecterConfig(ACCESS_TOKEN, sampleConfig);

      const callArgs = mockedAxios.put.mock.calls[0];
      const requestPayload = callArgs[1] as { config: SpecterConfigShape };
      
      expect(requestPayload).toEqual({ config: sampleConfig });
      expect(requestPayload).toHaveProperty('config');
      expect(requestPayload.config).toEqual(sampleConfig);
    });

    it('handles config with special characters and values', async () => {
      const complexConfig: SpecterConfigShape = {
        businessStage: 'survival',
        focusAreas: ['cash-flow', 'inventory', 'marketing'],
        aiAssistsEnabled: false,
        nested: { level1: { level2: 'deep' } },
        array: [1, 2, 3],
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        number: 123.45,
        boolean: true
      };

      mockedAxios.put.mockResolvedValueOnce({
        data: { shopId: 42, config: complexConfig }
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, complexConfig);

      expect(result.config).toMatchObject(complexConfig);
    });
  });

  describe('Type safety and validation', () => {
    it('accepts config with index signature', async () => {
      const dynamicConfig: SpecterConfigShape = {
        businessStage: 'growth',
        // Dynamic properties should be allowed
        dynamicField: 'value',
        'another-field': 123,
        123: 'numeric-key'
      };

      mockedAxios.put.mockResolvedValueOnce({
        data: { shopId: 42, config: dynamicConfig }
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, dynamicConfig);

      expect(result.config).toEqual(dynamicConfig);
    });

    it('handles config with array focusAreas', async () => {
      const configWithArrays: SpecterConfigShape = {
        businessStage: 'architect',
        focusAreas: ['scaling', 'automation', 'analytics'],
        tags: ['urgent', 'review-needed']
      };

      mockedAxios.put.mockResolvedValueOnce({
        data: { shopId: 42, config: configWithArrays }
      } as any);

      const result = await upsertSpecterConfig(ACCESS_TOKEN, configWithArrays);

      expect(Array.isArray(result.config?.focusAreas)).toBe(true);
      expect(result.config?.focusAreas).toHaveLength(3);
    });
  });
});