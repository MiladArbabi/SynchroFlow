import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Normalized SVG coordinate system.
 * All visuals are designed for a 100x100 viewBox
 * and scale via container size.
 */
const VIEWBOX_SIZE = 100;
/**
 * Number of vertical strokes in the base field.
 * Locked by design.
 */
const STROKE_COUNT = 18;
/**
 * Determines whether a stroke should be visible
 * in the 'insufficient-data' state.
 *
 * Even distribution, deterministic.
 */
const isVisibleInInsufficientData = (index) => {
    return index % 2 === 0;
};
/**
 * Deterministic micro-jitter for 'unverified' state.
 * Produces subtle vertical instability without animation.
 */
const getUnverifiedJitter = (index) => {
    // Values oscillate between -1 and +1 px
    return ((index % 3) - 1) * 0.8;
};
/**
 * BlindnessVisual
 */
export const BlindnessVisual = ({ status }) => {
    const isInsufficientData = status === 'insufficient-data';
    const isNotVisible = status === 'not-visible';
    const isUnverified = status === 'unverified';
    const isUnknown = status === 'unknown';
    return (_jsxs("svg", { viewBox: `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`, width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true", focusable: "false", "data-testid": "blindness-visual", children: [_jsx("defs", { children: _jsx("filter", { id: "unknown-blur", x: "-20%", y: "-20%", width: "140%", height: "140%", children: _jsx("feGaussianBlur", { stdDeviation: "2.5" }) }) }), _jsx("g", { "data-testid": "blindness-base-field", opacity: isNotVisible ? 0.35 : 1, transform: isNotVisible
                    ? 'translate(5 5) scale(0.9)'
                    : undefined, filter: isUnknown ? 'url(#unknown-blur)' : undefined, children: Array.from({ length: STROKE_COUNT }).map((_, index) => {
                    const x = ((index + 1) * VIEWBOX_SIZE) / (STROKE_COUNT + 1);
                    const visible = !isInsufficientData ||
                        isVisibleInInsufficientData(index);
                    const jitterY = isUnverified
                        ? getUnverifiedJitter(index)
                        : 0;
                    return (_jsx("rect", { x: x - 1, y: jitterY, width: 2, height: VIEWBOX_SIZE, fill: "currentColor", opacity: visible ? 0.25 : 0 }, index));
                }) }), isUnknown && (_jsx("rect", { x: 0, y: 0, width: VIEWBOX_SIZE, height: VIEWBOX_SIZE, fill: "currentColor", opacity: 0.12, "data-testid": "blindness-unknown-veil" })), _jsx("g", { "data-testid": "blindness-distortion", "data-status": status })] }));
};
export default BlindnessVisual;
