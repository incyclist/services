export const Injectable = (target:any, descriptor: any) =>{
    if (descriptor.kind==='method') {

        const original = target
        if (descriptor.name.startsWith('get')) {        
            const name = descriptor.name.slice(3)
            return function() {
                //console.log('getting injected',name)
                return Container.get(name)??this.injected?.[name]??original.call(this)
            }

        }
    }
}

class Container{
    protected static injected:Record<string,any>={}

    static set(key:string, value:any) {
        //console.log('Injecting',key)
        this.injected[key] = value
    }   

    static get(key:string) {
        return this.injected[key]
    }
 
}


export const Inject = (id:string, value:any ) =>{ 
    Container.set(id, value)
}

