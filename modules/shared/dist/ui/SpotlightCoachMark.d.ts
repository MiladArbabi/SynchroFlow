interface SpotlightCoachMarkProps {
    title: string;
    body: string;
    /** Controlled externally — resolved via useSpotlight() at page/app level */
    isDismissed: boolean;
    onDismiss: () => void;
    step?: number;
    totalSteps?: number;
}
export declare function SpotlightCoachMark({ title, body, isDismissed, onDismiss, step, totalSteps, }: SpotlightCoachMarkProps): import("react/jsx-runtime").JSX.Element | null;
export {};
//# sourceMappingURL=SpotlightCoachMark.d.ts.map