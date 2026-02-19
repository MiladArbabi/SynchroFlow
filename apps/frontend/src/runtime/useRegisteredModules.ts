
import { useEffect, useState } from 'react';
import {
  getRegisteredModules,
  subscribeModules
} from './registerModule';

export function useRegisteredModules() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    return subscribeModules(() => {
      forceUpdate(v => v + 1);
    });
  }, []);

  return getRegisteredModules();
}
