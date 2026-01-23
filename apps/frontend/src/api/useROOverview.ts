// apps/frontend/src/api/useROOverview.ts

import { useEffect, useState } from 'react';
import { useEntitlements } from 'contexts/EntitlementsContext';

export function useROOverview() {
  const { shopId } = useEntitlements();
  const [data, setData] = useState<{ trust: unknown; domains: Record<string, unknown> } | null>(null);

  useEffect(() => {
    if (!shopId) return;

    fetch(`/api/v1/modules/overview?shopId=${shopId}`)
      .then(res => res.json())
      .then(setData);
  }, [shopId]);

  return data;
}
