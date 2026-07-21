/**
 * BlindnessVisual
 * ----------------
 * Pure visual interpreter for SemanticStatus.
 *
 * Responsibilities:
 * - Render an abstract SVG representing latent signal
 * - Apply status-specific distortions
 *
 * Explicitly NOT responsible for:
 * - Layout
 * - Sizing
 * - Theming
 * - Copy
 * - Interactivity
 */
import React from 'react';
import { SemanticStatus } from '../types.js';
export interface BlindnessVisualProps {
    status: SemanticStatus;
}
/**
 * BlindnessVisual
 */
export declare const BlindnessVisual: React.FC<BlindnessVisualProps>;
export default BlindnessVisual;
//# sourceMappingURL=BlindnessVisual.d.ts.map