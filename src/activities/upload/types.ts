export interface Credentials {
    username?: string;
    password?: string
}


export interface VeloHeroAuth extends Credentials {
    id?: string;
    authKey?: string;
}