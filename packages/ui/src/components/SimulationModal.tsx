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
        {/* Form content will go here in the next step */}
        <div style={{ marginTop: '1.5rem' }}>
          <p>Simulation form will be here.</p>
        </div>
      </div>
    </div>
  );
}