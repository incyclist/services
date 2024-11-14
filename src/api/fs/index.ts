export interface IFileSystem {
    writeFile(...args)
    readFile(...args) 
    appendFile(...args)
    deleteFile(path)
    createWriteStream(...args)
    createReadStream(...args)

    access(path:string,mode?:number):Promise<void>
    existsSync(path:string):boolean
    checkDir(path:string):void

}