export type VeloHeroLoginReponse = {
    /** Username */
    username: string;
    /** Session ID */
    session: string;

    /** Indicates if the user has a pro account (required for upload to be supported) */
    isPro: boolean;

    /** VeloHero User ID */
    id: string
}

export type VeloHeroUploadProps = {
    /** Username */
    username?: string;
    /** Password */
    password?: string;
    /** file format ( TCX,FIT,...), needs to be supproted by VeloHero */
    format?: string 
}
export type VeloHeroAccountType = 'Pro' | 'Free'