export interface IFileSystem {
    writeFile(...args)
    readFile(...args) 
    appendFile(...args)
    deleteFile(path)
    createWriteStream(...args)
    createReadStream(...args)
    unlink(path)

    access(path:string,mode?:number):Promise<void>
    
    existsFile(path):Promise<boolean>
    existsDir(path):Promise<boolean>
    mkdir(path):Promise<void>
    ensureDir(path):Promise<void>


}