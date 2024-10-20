import path from "path";

export interface IPathBinding  {
    join(...paths:string[]) 
    parse(path:string):path.ParsedPath
}


export default class PathSupport {

    static _binding:IPathBinding = undefined;

    static initBinding(binding: IPathBinding) {
        PathSupport._binding = binding
        
    }

    static join(...paths:string[]):string {
        const binding = PathSupport._binding
        if (!binding)        
            throw new Error('no binding')
        return binding.join(...paths)
    }

    static parse(path:string):path.ParsedPath {
        const binding = PathSupport._binding
        if (!binding)        
            throw new Error('no binding')
        return binding.parse(path)
        
    }

}



