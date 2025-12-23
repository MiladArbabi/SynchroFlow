//apps/frontend/src/activation/FT0PromotionListener.tsx
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function FT0PromotionListener() {
  const qc = useQueryClient();

  useEffect(() => {
    const handler = () => {
      qc.invalidateQueries({ queryKey: ['activation-verdict'] });
      qc.invalidateQueries({ queryKey: ['userState'] });
      qc.invalidateQueries({ predicate: q => q.queryKey[0] === 'module-data' });
    };

    window.addEventListener('ft0:completed', handler);
    return () => window.removeEventListener('ft0:completed', handler);
  }, [qc]);

  return null;
}
