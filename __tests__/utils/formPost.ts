import {fileFromPath} from 'formdata-node/file-from-path'
import {FormData} from "formdata-node"
import axios from 'axios';

export class AxiosFormPost  {

    async createForm(opts,uploadInfo) {
        const keys = Object.keys(uploadInfo??{})

        const form = new FormData();

        for (let i=0;i<keys.length;i++) {
            const key = keys[i]

            if (key==='file') {
                const info = uploadInfo.file
                if (info.type==='file') {
                    form.append(key, await fileFromPath(info.fileName))
                }
                else if (info.type==='url') {
                    // TODO
                }
            }
            else {
                form.append(key,uploadInfo[key])
            }
        }

        
        return {uri:opts.uri, form}
    }

    async post(opts) { 
        const url = opts.uri
        const form = opts.form
        
        

        try  {
            return await axios.post(url,form)

        }
        catch(err) {
            return {error:err}
        }
    }
}