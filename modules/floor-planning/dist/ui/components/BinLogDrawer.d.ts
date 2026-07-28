import type { BinLogEvent } from '@lasyncro/shared/ui';
interface BinLogDrawerProps {
    locationCode: string;
    events: BinLogEvent[];
    isLoading: boolean;
    open: boolean;
    onClose: () => void;
}
export declare function BinLogDrawer({ locationCode, events, isLoading, open, onClose }: BinLogDrawerProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=BinLogDrawer.d.ts.map