import { AxiosInstance } from 'axios';
import { RestApiClient, getBindings } from '../../../../api';
import { useUserSettings } from '../../../../settings';
import { valid } from '../../../../utils/valid';
import { VeloHeroAccountType, VeloHeroLoginReponse, VeloHeroUploadProps } from './types';
import { Form } from '../../../../api/form';

const BASE_URL = 'https://app.velohero.com'

/**
 * Represents a client implementation of the  VeloHero API 
 * 
 * @example
 * // Create a new instance of VeloHeroApi
 * const api = new VeloHeroApi();
 * 
 * // Authenticate the user
 * api.login('username', 'password')
 *     .then(response => {
 *         console.log('Login successful:', response);
 *     })
 *     .catch(error => {
 *         console.error('Error during login:', error);
 *     });
 * 
 * // Upload a file
 * const fileName = 'example.csv';
 * api.upload(fileName)
 *     .then(success => {
 *         if (success) {
 *             console.log('File uploaded successfully.');
 *         } else {
 *             console.error('Failed to upload file.');
 *         }
 *     })
 *     .catch(error => {
 *         console.error('Error during file upload:', error);
 *     });
 * 
 * // Check if the user is authenticated
 * const authenticated = api.isAuthenticated();
 * console.log('Is authenticated:', authenticated);
 * 
 * @class
 * @public
 */
export default class VeloHeroApi  {

    protected api: AxiosInstance
    protected username: string
    protected password: string
    protected loginResponse:VeloHeroLoginReponse

    /**
     * Authenticates the user with VeloHero API.
     * @param {string} username - The username.
     * @param {string} password - The password.
     * @returns {Promise<VeloHeroLoginReponse>} The login response.
     */
    async login(username,password):Promise<VeloHeroLoginReponse> {
        try {
            const url = `/sso?user=${username}&pass=${password}&view=json`
            const response = await this.get(url)
            
            if (response.status===403) {
                throw new Error('invalid credentials')
            }

            else if (response.data) {
 
                this.username = username;
                this.password = password
                
                this.loginResponse = {
                    username,
                    id: response.data['user-id'],
                    session:response.data.session,
                    isPro: response.data['user-pro'],

                }
                return this.loginResponse
            }
            else {
                throw new Error( `HTTP error ${response.status}: ${response.statusText}`)
            }
            
        }
        catch(err) {
            let error = `Internal error: ${err.message}`
            if (err.response) {
                const {response} = err;
                error = `HTTP error ${response.status}: ${response.statusText}`
            }

            throw new Error(error)
        }
    }

    /**
     * Gets the account type of the authenticated user. ("Pro" or "Free")
     * @returns {VeloHeroAccountType} The account type.
     * @throws {Error} Throws an error if not authenticated.
     */
    getAccountType():VeloHeroAccountType {
        if (!this.loginResponse) {
            throw new Error('not authenticated')
        }
        return this.loginResponse.isPro ? 'Pro' : 'Free'
    }

    /**
     * Checks if the user is authenticated.
     * @returns {boolean} Indicates if the user is authenticated.
     */
    isAuthenticated() {
        return valid(this.username) && valid(this.password)
    }


    /**
     * Uploads a file to VeloHero
     * @param {string} fileName - The full path of the file to upload.
     * @param {VeloHeroUploadProps} [props] - Additional upload properties.
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     * @throws {Error} Throws an error if not authenticated.
     */
    async upload(fileName:string, props?:VeloHeroUploadProps) {

        if (!this.loginResponse && (!props?.username && !props?.password)) {
            throw new Error('not authenticated')
        }
        
        const username = props?.username?? this.username
        const password = props?.password??this.password

        const uploadInfo = {
            file: { type:'file', fileName}, 
            user: username,
            pass: password,
            view: 'json'
        };

        
        
        try {
            const form =await this.createForm('/upload/file',uploadInfo)

            const response = await this.postForm(form)
            if (response.data && !response.error) {
                return true;
            }
            else {
                throw new Error( response.error?.response?.data?.error|| response.error.message||response.error||`HTTP error ${response.status}`)
            }
        }
        catch(err) {
            console.log(err)
            throw err
        }

    }
    

    protected getBaseUrl() {
        try {
            return useUserSettings().get('VELOHERO_API',BASE_URL)
        }
        catch {
            return BASE_URL
        }
    }


    protected async get(url:string, config?:object) {

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

 
    protected async postForm (form:Form) {
        const fp = this.getFormBinding()        

        return await fp.post( form);
    
    }

    protected async createForm(url:string,uploadInfo:object):Promise<Form> {
        const fp = this.getFormBinding()        
        const form =  await fp.createForm({uri:this.getBaseUrl()+url},uploadInfo);
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