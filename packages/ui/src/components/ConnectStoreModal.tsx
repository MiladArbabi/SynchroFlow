import React from 'react';

interface ConnectStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectStoreModal: React.FC<ConnectStoreModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }

  return (
    // Full-screen overlay
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity z-10">
      <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          
          {/* Modal Panel */}
          <div className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
            <div>
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
            </div>
            {/* We will add the integration grid here next */}
            <div className="mt-5 sm:mt-6">
              <button
                type="button"
                className="inline-flex w-full justify-center rounded-md bg-gray-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-500"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};