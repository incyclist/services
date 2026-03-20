
export type SupportUrl =  {
    label: string,
    text: string
    url: string,
}

export type SupportSettingsDisplayProps = {
    uuid: string, 
    appVersion: string,
    uiVersion: string,
    privacyUrl: string,
    supportUrls: Array<SupportUrl>
    gitHubUrl: string,
    donationUrl: string
}