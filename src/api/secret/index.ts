export interface ISecretBinding {
    getSecret(key:string):string    
    init():Promise<void>
}