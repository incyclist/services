export const COPY = {
    appInfoTitle: 'App info',
    helpTitle: 'Need help?',

    donationTitle: 'Support Incyclist',
    promise: 'Incyclist is free and stays free. There is no subscription and nothing to unlock.',
    fundsText: "If you'd like to help, donations pay for the server, app-store fees and code signing.",
    note: 'Donating is entirely voluntary and changes nothing in the app. You can also help by answering questions in the Strava club or contributing on GitHub.',

    paypalLabel: 'PayPal',
    paypalSubLabel: 'one-time',
    sponsorsLabel: 'GitHub Sponsors',
    sponsorsSubLabel: 'one-time or monthly',

    websiteLabel: 'Ways to support Incyclist ↗',

    stravaLabel: 'Incyclist Strava Club',
    stravaShortLabel: 'Strava club',
    slackLabel: 'Incyclist Slack Workspace',
    slackShortLabel: 'Slack',
    emailShortLabel: 'Email',
    gitHubLabel: 'GitHub',

    copyDetailsLabel: 'Copy details',
    shareDetailsLabel: 'Share details',

    appVersionLabel: 'App version',
    uiVersionLabel: 'UI version',
    uuidLabel: 'uuid',
    privacyLabel: 'Privacy',
    privacyLinkLabel: 'Privacy Statement',
    uuidCopyAction: 'Copy',
    uuidShareAction: 'Share',

    summaryText: "Incyclist is free and stays free. If you'd like to help with server and app-store costs:",
    summaryShortText: 'Incyclist is free and stays free. Like to help with costs?',
    hideLabel: 'Hide',
} as const

export const compactVersionText = (appVersion: string, uiVersion: string) => `Version: App ${appVersion} · UI ${uiVersion}`

export const copiedMessage = (address: string) => `Copied. Paste it into an email to ${address}.`

export const EMAIL_COPY = {
    subject: 'Incyclist support request',
    greeting: 'Hello,',
    prompt: '[Describe your problem here. What did you do, and what happened?]',
    divider: '--------------------------------------------',
    keepNote: 'Please keep the details below. They help us find your logs.',
    uuidLabel: 'uuid',
    appVersionLabel: 'App version',
    uiVersionLabel: 'UI version',
} as const
