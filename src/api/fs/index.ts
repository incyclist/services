export interface ReadDirResult {
    name: string
    uri: string
    isDirectory: boolean
}

export interface IFileSystem {
    writeFile(...args)
    readFile(...args):Promise<string|Buffer>
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
    readdir?(path:string, options?: { recursive?: boolean }):Promise<string[]>
    readdir?(path:string, options: { recursive?: boolean; extended: true }):Promise<ReadDirResult[]>

}