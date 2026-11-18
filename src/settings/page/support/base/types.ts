export type DonationChannelId = 'paypal' | 'github-sponsors'
export type DonationMode = 'direct' | 'website'
export type SupportHelpLinkId = 'strava' | 'slack' | 'email'

export type DonationChannel = { id: DonationChannelId; label: string; subLabel: string; url: string; primary: boolean }
export type SupportLink = { label: string; url: string }

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
    otherHelpLinks: SupportLink[]
}

export type SupportAppInfoDisplayProps = {
    title: string
    appVersion: string
    uiVersion: string
    uuid: string
    privacyUrl: string
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

export type SupportSettingsPageDisplayProps = {
    appInfo: SupportAppInfoDisplayProps
    helpTitle: string
    /** order: strava, slack, email */
    helpLinks: SupportHelpLink[]
    donation: SupportDonationDisplayProps
}

export type SupportLinkClickId = SupportHelpLinkId | 'privacy' | 'github'
export type DonationClickId = DonationChannelId | 'website'
