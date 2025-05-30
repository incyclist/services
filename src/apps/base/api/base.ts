import { AxiosInstance, AxiosResponse } from "axios";
import { Form } from "../../../api/form";
import { RestApiClient, getBindings } from "../../../api";
import { useUserSettings } from "../../../settings";

export class AppApiBase {
    protected api: AxiosInstance

    protected getBaseUrl():string {
        throw new Error('not implemented')
    }

    protected async get(url:string, config?:object):Promise<AxiosResponse> {

        const props = config??{}
        
        const request = {
            method:'get',
            url: this.getBaseUrl()+url,
            validateStatus: (status) => {
                return (status >= 200 && status < 300) || status===403;
            },
            ...props            
        }

        return await this.getApi().request(request )  
    }

    protected async post(url:string, data?:object|string, config?:object):Promise<AxiosResponse> {

        const props = config??{}
        
        const request = {
            method:'post',
            url: this.getBaseUrl()+url,
            data,
            validateStatus: (status) => {
                return (status >= 200 && status < 300) || status===403;
            },
            ...props            
        }
        return await this.getApi().request(request )  
    }

 
    protected async postForm (form:Form) {
        const fp = this.getFormBinding()        

        const response = await fp.post( form);

        if (response.data?.data)
            response.data = response.data?.data
        return response
}

    protected async createForm(url:string,uploadInfo:object, requestOpts={}):Promise<Form> {
        const fp = this.getFormBinding()        
        const form =  await fp.createForm({url:this.getBaseUrl()+url, ...requestOpts},uploadInfo);

        return form
    }
    

    // istanbul ignore next
    protected getApi():AxiosInstance {
        if (!this.api) {
            this.api = RestApiClient.getClient()
            return this.api
        }
        return this.api
    }

    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }

    // istanbul ignore next
    protected getFormBinding() {
        return getBindings()?.form
    }


} 