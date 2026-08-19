export type ProblemTask = {
    problem_task_id: string;
    lasyncro_variant_id: string;
    exception_type: string;
    source: 'pick' | 'pack' | 'stow' | 'receive' | 'returns';
    quantity: number;
    prob_label: string | null;
    problem_bin_location: string | null;
    status: 'open' | 'investigating' | 'resolved' | 'discarded' | 'returned_to_supplier';
    created_at: string;
    variant_title?: string | null;
    sku?: string | null;
};
export type ProblemCenterData = {
    tasks: ProblemTask[];
    total_unresolved: number;
} | null;
export type ProblemCenterModuleFT2Props = {
    data: ProblemCenterData;
    isLoading: boolean;
    isError: boolean;
    onResolve: (taskId: string, action: string, note: string) => Promise<void>;
    onRefresh: () => void;
};
export default function ProblemCenterModuleFT2(props: ProblemCenterModuleFT2Props): import("react").JSX.Element;
//# sourceMappingURL=ProblemCenterModuleFT2.d.ts.map