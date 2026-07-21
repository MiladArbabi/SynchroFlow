import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const ActivationSurface = ({ identity, blindness, absenceProof, valueAfterActivation, primaryCTA, trust, postActivation, onAction, }) => {
    return (_jsxs("section", { "data-testid": "activation-surface", children: [identity && _jsx("h1", { children: identity.title }), blindness && (_jsxs("div", { children: [blindness.subject, " \u2014 ", blindness.dimension, " (", blindness.status, ")"] })), absenceProof && _jsx("div", { children: absenceProof.riskStatement }), valueAfterActivation && _jsx("div", { children: valueAfterActivation.outcome }), primaryCTA && (_jsx("button", { onClick: () => {
                    console.log('[ActivationSurface] CTA clicked', {
                        actionId: primaryCTA.actionId,
                        hasOnAction: Boolean(onAction),
                    });
                    onAction?.(primaryCTA.actionId);
                }, children: primaryCTA.label })), _jsx("div", { children: trust.bullets.map((line, idx) => (_jsx("div", { children: line }, idx))) }), postActivation && _jsx("div", { children: postActivation.reflection })] }));
};
