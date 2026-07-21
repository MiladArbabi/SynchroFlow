/**
 * FT2Panel
 * --------
 * Unified panel primitive for FT2 dashboards.
 *
 *
 * Panel owns:
 *
 *  - visual surface
 *  - title header
 *  - padding
 *  - trust boundary
 *  - row container
 *
 * Layout participation:
 *
 * Panels implement the FT2Row span contract.
 *
 *   <FT2Row>
 *     <FT2Panel span={1}/>
 *     <FT2Panel span={2}/>
 *   </FT2Row>
 *
 * This file intentionally does NOT depend on InfoBlock
 * to prevent reintroducing the dual container architecture.
 */
import type { ReactNode } from 'react';
export type FT2PanelProps = {
    id?: string;
    title?: string;
    children?: ReactNode;
    /**
     * Span participation in FT2Row layout engine.
     */
    span?: number;
    /**
     * Epistemic trust boundary.
     */
    trustTone?: 'trusted' | 'constrained' | 'blocked';
};
export declare function FT2Panel({ id, title, children, span, trustTone, }: FT2PanelProps): import("react/jsx-runtime").JSX.Element;
