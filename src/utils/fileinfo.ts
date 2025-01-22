import { FileInfo } from "../api";

export const getFileName = (file: FileInfo) => {
    const {type} = file

    if (type==='url') {
        if (file.url.startsWith('file:')) 
            return file.url.slice(8)
        return file.url
    }

    return file.filename
}