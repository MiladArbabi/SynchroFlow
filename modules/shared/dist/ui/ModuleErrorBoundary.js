import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
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
export class ModuleErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, info) {
        // Surface module crashes clearly — replace with your error reporter (e.g. Sentry) when available.
        console.error(`[ModuleErrorBoundary][${this.props.moduleName}]`, error, info.componentStack);
    }
    render() {
        if (this.state.hasError) {
            return (_jsxs("div", { style: { padding: 32, fontFamily: 'sans-serif' }, children: [_jsxs("strong", { children: ["[", this.props.moduleName, "] Something went wrong."] }), _jsx("pre", { style: { marginTop: 8, fontSize: 12, opacity: 0.6 }, children: this.state.error?.message })] }));
        }
        return _jsx(_Fragment, { children: this.props.children });
    }
}
