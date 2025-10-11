import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MappingRule } from './types';

const DataMapper: React.FC = () => {
    const [rules, setRules] = useState<MappingRule[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
    const fetchRules = async () => {
      try {
        // We'll hardcode shop_id=1 for now
        const response = await axios.get('/api/v1/mappings?shop_id=1');
        setRules(response.data);
      } catch (_err) {
        setError('Failed to fetch mapping rules.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRules();
  }, []); // Empty dependency array means this runs once on mount


  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-base font-semibold leading-6 text-gray-900">Data Mapping Rules</h1>
          <p className="mt-2 text-sm text-gray-700">
            Manage the mapping rules for your integrated platforms.
          </p>
        </div>
      </div>
      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            {isLoading ? (
              <p>Loading rules...</p>
            ) : error ? (
              <p className="text-red-500">{error}</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-300">
                <thead>
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">Source Path</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Target Path</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Platform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rules.length > 0 ? (
                    rules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">{rule.source_field_path}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{rule.target_field_path}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{rule.source_platform}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="text-center py-4 text-sm text-gray-500">No mapping rules found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataMapper;