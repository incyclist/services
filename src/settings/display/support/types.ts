import type { DonationChannel, DonationChannelId, DonationMode } from '../../support/types'

export type { DonationChannel, DonationChannelId, DonationMode }

export type SupportUrl =  {
    label: string,
    text: string
    url: string,
}

export type SupportHelpLinkId = 'strava' | 'slack' | 'email'

export type SupportLink = { label: string; url: string }
export type SupportOtherHelpLink = SupportLink & { id: 'strava' | 'github' }

export type SupportDonationDisplayProps = {
    title: string
    promise: string
    /** omitted in 'website' mode */
    fundsText?: string
    mode: DonationMode
    /** empty in 'website' mode */
    channels: DonationChannel[]
    /** 'website' mode only; host derived from the url */
    websiteLink?: SupportLink & { host: string }
    note: string
    /** Strava club, GitHub */
    otherHelpLinks: SupportOtherHelpLink[]
}

export type SupportAppInfoDisplayProps = {
    title: string
    appVersion: string
    uiVersion: string
    uuid: string
    privacyUrl: string
    labels: {
        appVersion: string
        uiVersion: string
        uuid: string
        privacy: string
        privacyLink: string
    }
    /** 'Version: App <appVersion> · UI <uiVersion>' */
    compactVersionText: string
    /** desktop 'Copy' | mobile 'Share' */
    uuidActionLabel: string
}

export type SupportEmailDetails = {
    address: string
    subject: string
    body: string
    /** 'To: …\r\nSubject: …\r\n\r\n' + body */
    copyText: string
    /** desktop 'Copy details' | mobile 'Share details' */
    copyLabel: string
    /** desktop only */
    copiedMessage?: string
}

export type SupportHelpLink = {
    id: SupportHelpLinkId
    label: string
    shortLabel: string
    /** for 'email': the encoded mailto URL */
    url: string
    /** id 'email' only */
    email?: SupportEmailDetails
}

export type SupportSettingsDisplayProps = {
    uuid: string,
    appVersion: string,
    uiVersion: string,
    privacyUrl: string,
    supportUrls: Array<SupportUrl>
    gitHubUrl: string,
    donationUrl: string

    appInfo: SupportAppInfoDisplayProps
    helpTitle: string
    /** order: strava, slack, email */
    helpLinks: SupportHelpLink[]
    donation: SupportDonationDisplayProps
}

export type SupportLinkClickId = SupportHelpLinkId | 'privacy' | 'github'
export type DonationClickId = DonationChannelId | 'website'
