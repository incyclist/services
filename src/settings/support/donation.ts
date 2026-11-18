import { getBindings } from '../../api'
import type { IncyclistBindings } from '../../api'
import type { DonationChannel, DonationMode } from '../page/support/base/types'
import { COPY } from './copy'
import { getDonationUrl, getSponsorUrl } from './urls'

/**
 * Decides how donation options are presented.
 *
 * iOS only links to the website (no payment links inside the app), all other platforms link
 * directly to the payment channels. If the platform can't be determined, 'direct' is used.
 */
export const getDonationMode = (bindings: Partial<IncyclistBindings> | undefined = getBindings()): DonationMode => {
    try {
        const platform = bindings?.appInfo?.getOS()?.platform
        return platform === 'ios' ? 'website' : 'direct'
    }
    catch {
        return 'direct'
    }
}

/** The donation channels offered in 'direct' mode. PayPal is the primary one. */
export const getDonationChannels = (): DonationChannel[] => [
    { id: 'paypal', label: COPY.paypalLabel, subLabel: COPY.paypalSubLabel, url: getDonationUrl(), primary: true },
    { id: 'github-sponsors', label: COPY.sponsorsLabel, subLabel: COPY.sponsorsSubLabel, url: getSponsorUrl(), primary: false },
]
