/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';

export function useROOverview(shopId: number) {
  const [data, setData] = useState<{ trust: any; domains: Record<string, any> } | null>(null);

  useEffect(() => {
    if (!shopId) return;

    fetch(`/api/v1/modules/overview?shopId=${shopId}`)
      .then(res => res.json())
      .then(setData);
  }, [shopId]);

  return data;
}