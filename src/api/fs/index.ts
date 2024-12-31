export interface IFileSystem {
    writeFile(...args)
    readFile(...args) 
    appendFile(...args)
    deleteFile(path)
    createWriteStream(...args)
    createReadStream(...args)
    unlink(path)

    access(path:string,mode?:number):Promise<void>
    existsSync(path:string):boolean
    checkDir(path:string):void

}