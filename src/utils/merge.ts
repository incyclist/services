/* eslint-disable @typescript-eslint/no-explicit-any */

export function merge(base:any,data:any,depth=0) {       
    let key;
    for (key in data) {
        if (typeof(data[key])==='object' && depth<4) {
            if (base[key]!==undefined)
                this.merge(base[key],data[key])
            else
                base[key]= data[key]    
        }
        else
            base[key]= data[key]
    }
}