/**
 * Result of a directory listing operation.
 *
 * @field name - The canonical item name as it appears in the directory.
 * @field uri - The canonical path to the item.
 * @field isDirectory - Whether this item is a directory.
 *
 * Note: Platform bindings resolve placeholder or dataless storage representations
 * (e.g., iCloud "broken link" placeholders) before returning results. The name and uri
 * fields always represent accessible, canonical identifiers for the item.
 */
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