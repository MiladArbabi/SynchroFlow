import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
export const ModuleActivationBoundary = ({ activation, children, renderBlocked }) => {
    if (activation.state === 'BLOCKED') {
        return renderBlocked ? renderBlocked(activation.surface) : null;
    }
    return _jsx(_Fragment, { children: children });
};
