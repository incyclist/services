import { valid } from '../../../../utils/valid';
import { VeloHeroAccountType, VeloHeroLoginReponse, VeloHeroUploadProps, VeloHeroUploadResponse } from './types';
import { AppApiBase } from '../base';

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
export class VeloHeroApi  extends AppApiBase{

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
            if (err.message==='invalid credentials')
               throw err
            
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
    async upload(fileName:string, props?:VeloHeroUploadProps):Promise<VeloHeroUploadResponse> {

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
    
        const form =await this.createForm('/upload/file',uploadInfo)

        const response = await this.postForm(form)
        if (response.data && !response.error) {
            
            return response.data;
        }
        else {
            const errMessage =  response.error?.response?.data?.error?? response.error?.response?.message ??  response.error.message
            throw new Error( errMessage ?? `HTTP error ${response.status}`)
        }

    }
    

    protected getBaseUrl() {
        try {
            return this.getUserSettings().get('VELOHERO_API',BASE_URL)
        }
        catch {
            return BASE_URL
        }
    }


}