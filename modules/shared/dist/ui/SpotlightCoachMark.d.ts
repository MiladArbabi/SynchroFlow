interface SpotlightCoachMarkProps {
    title: string;
    body: string;
    /** Controlled externally — resolved via useSpotlight() at page/app level */
    isDismissed: boolean;
    onDismiss: () => void;
    step?: number;
    totalSteps?: number;
    /** Optional pointer — renders a small triangle on the given edge, aimed at the coached element. */
    direction?: 'up' | 'down' | 'left' | 'right';
}
export declare function SpotlightCoachMark({ title, body, isDismissed, onDismiss, step, totalSteps, direction, }: SpotlightCoachMarkProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=SpotlightCoachMark.d.ts.map