import modules from 'virtual:lasyncro-modules';
import { loadAllModules } from 'runtime/moduleLoader';

(async function debug() {
  console.debug('[lasyncro-debug] debug bootstrap: modules list ->', modules);
  try {
    const res = await loadAllModules(); // this will invoke your loader's logic
    console.debug('[lasyncro-debug] loadAllModules returned ->', res);
  } catch (err) {
    console.error('[lasyncro-debug] loadAllModules ERROR ->', err && err.stack ? err.stack : err);
  }
})();
