/* eslint-disable @typescript-eslint/no-explicit-any */

export function merge(base:any,data:any,depth=0) {       
    let key;
    for (key in data) {
        if (typeof(data[key])==='object' && depth<4) {
            if (base[key]!==undefined && data[key]!==null) 
                this.merge(base[key],data[key])
            else if (base[key]!==undefined && data[key]===null) 
                delete base[key]
            else if (base[key]!==undefined && data[key]===undefined) {
               // do nothing
            }
            else
                base[key]= data[key]    
        }
        else
            base[key]= data[key]
    }
}