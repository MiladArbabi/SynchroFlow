/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'virtual:lasyncro-modules' {
  export interface LasyncroModuleRef {
    id: string;
    load: () => Promise<any>;
  }

  const modules: LasyncroModuleRef[];
  export default modules;
}
