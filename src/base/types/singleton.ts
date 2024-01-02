/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

export function Singleton<T extends new (...args: any[]) => any>(originalConstructor: T,_context): T {

    let instance: T;

    return class {

        constructor(...args: any[]) {
            if (instance) {
                return instance;
            }
            

            instance = new originalConstructor(...args);            
            (instance as any).reset = ()=> { instance = null}
            
            return instance;
        }



    } as T
}