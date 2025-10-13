import React, { useState } from 'react';
import axios from 'axios';

interface ConnectStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectStoreModal: React.FC<ConnectStoreModalProps> = ({ isOpen, onClose }) => {
  const [shopName, setShopName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

    if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      // We will add a real shopId when we have user sessions
      const payload = {
        shopId: 1, 
        shop: shopName,
        accessToken: accessToken,
      };
      await axios.post('/api/v1/integrations/shopify/start-trial-sync', payload);
      onClose(); // Close the modal on success
    } catch (err) {
        console.error(err.message);
        setError('Failed to initiate sync. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    // Full-screen overlay
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity z-10">
      <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          
          {/* Modal Panel */}
          <form onSubmit={handleSubmit} className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
            <div className="text-left">
              <div className="text-center">
                <h3 className="text-base font-semibold leading-6 text-gray-900">
                  Connect a Data Source
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Select a platform to begin your scoped live trial.
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                <div>
                  <label htmlFor="shop-name" className="block text-sm font-medium leading-6 text-gray-900">Shop Name</label>
                  <div className="mt-2">
                    <input
                      type="text"
                      id="shop-name"
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                      placeholder="my-store.myshopify.com"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="access-token" className="block text-sm font-medium leading-6 text-gray-900">Admin API Access Token</label>
                  <div className="mt-2">
                    <input
                      type="password"
                      id="access-token"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                      placeholder="shpat_..."
                      required
                    />
                  </div>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
            </div>
            <div className="mt-5 sm:mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
              <button
                type="submit"
                className="inline-flex w-full justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 sm:col-start-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Syncing...' : 'Start Sync'}
              </button>
              <button
                type="button"
                className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
            </button>
            </div>
        </form>
        </div>
      </div>
    </div>
  );
};