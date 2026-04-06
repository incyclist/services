export type SecretsStatus = 'ok' | 'stale' | 'missing'

export interface ISecretBinding {
    getSecret(key:string):string    
    init():Promise<void>
    getSecretsStatus(): SecretsStatus
}