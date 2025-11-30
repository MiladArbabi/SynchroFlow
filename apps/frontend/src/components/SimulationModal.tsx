import React from 'react';

interface SimulationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SimulationModal({ isOpen, onClose }: SimulationModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    // Modal Overlay
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {/* Modal Content */}
      <div style={{
        backgroundColor: 'white', padding: '2rem', borderRadius: '0.5rem',
        width: '90%', maxWidth: '500px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600' }}>
            Simulate a Scenario
          </h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>
            &times;
          </button>
        </div>
        <form style={{ marginTop: '1.h5rem' }}>
          <div>
            <label htmlFor="paymentAmount" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#434D5B' }}>
              Payment Amount
            </label>
            <div style={{ marginTop: '0.25rem' }}>
              <input
                type="number"
                id="paymentAmount"
                name="paymentAmount"
                defaultValue={7500}
                style={{ display: 'block', width: '100%', border: '1px solid #D1D5DB', padding: '0.5rem' }}
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <label htmlFor="delayPeriod" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#434D5B' }}>
              Delay by (weeks)
            </label>
            <div style={{ marginTop: '0.25rem' }}>
              <input
                type="number"
                id="delayPeriod"
                name="delayPeriod"
                defaultValue={2}
                style={{ display: 'block', width: '100%', border: '1px solid #D1D5DB', padding: '0.5rem' }}
              />
            </div>
          </div>
          <div style={{ marginTop: '2rem' }}>
            <button
              type="submit"
              style={{ width: '100%', backgroundColor: '#2F54EB', color: 'white', fontWeight: '600', padding: '0.75rem', border: 'none', borderRadius: '0.25rem' }}
            >
              Run Simulation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}