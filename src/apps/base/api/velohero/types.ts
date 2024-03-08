export type VeloHeroLoginReponse = {
    username: string;
    session: string;
    isPro: boolean;
    id: string
}

export type VeloHeroUploadProps = {
    username?: string;
    password?: string;
    format?: string 
}
export type VeloHeroAccountType = 'Pro' | 'Free'