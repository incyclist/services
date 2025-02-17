import { AppCredentials } from "../base/types";

export interface VeloHeroCredentials extends AppCredentials {
    username: string,
    password: string
}

export interface VeloHeroAuth {
    id: string
    authKey: string
}