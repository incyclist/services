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
            const resetFn = instance['reset']?.bind(instance)
            if (resetFn===undefined || typeof resetFn==='function') {
                instance['reset'] = ()=> { 
                    instance = null; 
                    if (resetFn) resetFn(); }                    
            }
            
            return instance;
        }



    } as T
}