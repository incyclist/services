import { AppChannel } from "../appInfo"

/**
 * Decides whether a request may end up at `finalUrl` after redirects
 *
 * @param finalUrl  the URL that is (or would be) followed / the response was served from
 * @param originUrl the URL that was requested originally
 * @returns false to refuse the redirect
 */
export type RedirectPolicy = (finalUrl: string, originUrl: string) => boolean

/** error code of a request that was refused by a `redirectPolicy` */
export const REDIRECT_NOT_ALLOWED = 'ERR_REDIRECT_NOT_ALLOWED'

declare module 'axios' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface AxiosRequestConfig<D = any> {
        /**
         * Per-request redirect control. If set, a redirect that the policy refuses fails the request with
         * code `ERR_REDIRECT_NOT_ALLOWED`.
         *
         * Where the transport allows it (Node), the redirect is refused before it is followed. Where a redirect
         * can not be stopped early (XHR in the browser / React Native), the URL that the response was served
         * from is checked once the response has arrived.
         */
        redirectPolicy?: RedirectPolicy
    }
}

export type ExternalApiClientInitProps = {
    version:string,
    appVersion:string
    requestLog?:boolean,
    channel?: AppChannel
    platform?: string
}
export type ApiClientInitProps = ExternalApiClientInitProps & {
    uuid: string,
    apiKey:string,
}
