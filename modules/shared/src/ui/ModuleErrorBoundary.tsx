// modules/shared/src/ui/ModuleErrorBoundary.tsx
//
// ModuleErrorBoundary
// -------------------
// Class-based React error boundary for all FT2 modules.
// Catches render-time errors and prevents full-app crashes.
//
// Usage: wrap the top-level module page component.
// <ModuleErrorBoundary moduleName="cashflow">
//   <CashFlowModuleFT2 />
// </ModuleErrorBoundary>

import React from 'react';

interface Props {
  moduleName: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ModuleErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface module crashes clearly — replace with your error reporter (e.g. Sentry) when available.
    console.error(`[ModuleErrorBoundary][${this.props.moduleName}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, fontFamily: 'sans-serif' }}>
          <strong>[{this.props.moduleName}] Something went wrong.</strong>
          <pre style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
            {this.state.error?.message}
          </pre>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}