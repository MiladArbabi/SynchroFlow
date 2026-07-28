import React from 'react';
interface Props {
    moduleName: string;
    children: React.ReactNode;
}
interface State {
    hasError: boolean;
    error: Error | null;
}
export declare class ModuleErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props);
    static getDerivedStateFromError(error: Error): State;
    componentDidCatch(error: Error, info: React.ErrorInfo): void;
    render(): React.JSX.Element;
}
export {};
//# sourceMappingURL=ModuleErrorBoundary.d.ts.map