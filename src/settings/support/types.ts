export type DonationChannelId = 'paypal' | 'github-sponsors'
export type DonationMode = 'direct' | 'website'

export type DonationChannel = { id: DonationChannelId; label: string; subLabel: string; url: string; primary: boolean }
