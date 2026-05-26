import { useCallback } from 'react';
import { ProblemCenterModuleFT2 } from '@lasyncro/problem-center';
import { useProblemCenter } from '../problem-center/useProblemCenter';
import { axiosInstance } from 'api/axiosConfig';
import { ModuleTabBar } from '../../components/ModuleTabBar';

const INVENTORY_TABS = [
  { id: 'intelligence',   label: 'Intelligence',   path: '/inventory'               },
  { id: 'catalog',        label: 'Catalog',        path: '/inventory/catalog'       },
  { id: 'costs',          label: 'Costs',          path: '/inventory/costs'         },
  { id: 'wms-readiness',  label: 'WMS Readiness',  path: '/inventory/wms-readiness' },
  { id: 'problem-center', label: 'Problem Center', path: '/problem-center'          },
];

export default function ProblemCenterPage() {
  const { data, isLoading, isError, refetch } = useProblemCenter();
  const handleResolve = useCallback(async (exceptionId: string, note: string) => {
    await axiosInstance.post(`/api/v1/wms/problem-center/pick-exceptions/${exceptionId}/resolve`, {
      resolution_note: note,
    });
  }, []);
  return (
    <>
      <ModuleTabBar tabs={INVENTORY_TABS} />
      <ProblemCenterModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      onResolve={handleResolve}
      onRefresh={refetch}
    />
    </>
  );
}