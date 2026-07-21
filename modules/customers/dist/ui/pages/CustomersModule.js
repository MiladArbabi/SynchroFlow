import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function CustomersModule(props) {
    console.debug('[FT1][Customers][CustomersModule] props', props);
    if (props.sessionsObserved === null) {
        return (_jsxs("section", { "data-testid": "customers-ft1-loading", children: [_jsx("strong", { children: "Analyzing customer sessions\u2026" }), _jsx("div", { children: "Session data is being validated." })] }));
    }
    if (props.sessionsObserved === 0) {
        return (_jsxs("section", { "data-testid": "customers-ft1-no-sessions", children: [_jsx("strong", { children: "No customer sessions detected yet" }), _jsx("div", { children: "We haven\u2019t observed any customer sessions for this store." })] }));
    }
    return (_jsxs("section", { "data-testid": "customers-ft1-ready", children: [_jsx("strong", { children: "Customer sessions detected" }), _jsxs("div", { children: [props.sessionsObserved, " sessions observed so far."] })] }));
}
//# sourceMappingURL=CustomersModule.js.map