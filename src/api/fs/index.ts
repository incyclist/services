export interface IFileSystem {
    writeFile(...args)
    readFile(...args) 
    appendFile(...args)
    deleteFile(path)
    createWriteStream(...args)
    createReadStream(...args)

    existsSync(path:string):boolean
    checkDir(path:string):void

}