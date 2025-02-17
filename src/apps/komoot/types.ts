import { AppCredentials } from "../base/types";

export interface KomootCredentials extends AppCredentials {
    username: string,
    password: string
    userid:string,
}

export interface KomootAuth {
    id: string
    authKey: string
}