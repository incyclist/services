const DEFAULT_PRIVACY_URL = 'https://incyclist.com/privacy'
const DEFAULT_SLACK_URL = 'https://join.slack.com/t/incyclist/shared_invite/zt-119wcvtjn-uiZ_Pw6gh5WLc0zT8jkfTg'
const DEFAULT_STRAVA_URL = 'https://www.strava.com/clubs/1029407'
export const DEFAULT_SUPPORT_EMAIL = 'support@incyclist.com'
const DEFAULT_GITHUB_URL = 'https://github.com/incyclist'
const DEFAULT_DONATION_URL = 'https://www.paypal.com/paypalme/incyclist'
const DEFAULT_SPONSOR_URL = 'https://github.com/sponsors/incyclist'
const DEFAULT_SUPPORT_PAGE_URL = 'https://incyclist.com/#support'

/** URL of the privacy statement (env override: PRIVACY_URL) */
export const getPrivacyUrl = (): string => process.env.PRIVACY_URL ?? DEFAULT_PRIVACY_URL

/** URL to join the Slack workspace (env override: SLACK_URL) */
export const getSlackUrl = (): string => process.env.SLACK_URL ?? DEFAULT_SLACK_URL

/** URL of the Strava club (env override: STRAVA_URL) */
export const getStravaUrl = (): string => process.env.STRAVA_URL ?? DEFAULT_STRAVA_URL

/** Support email address (env override: SUPPORT_EMAIL) */
export const getSupportEmail = (): string => process.env.SUPPORT_EMAIL ?? DEFAULT_SUPPORT_EMAIL

/** URL of the GitHub organisation (env override: GITHUB_URL) */
export const getGitHubUrl = (): string => process.env.GITHUB_URL ?? DEFAULT_GITHUB_URL

/** PayPal donation URL (env override: DONATION_URL) */
export const getDonationUrl = (): string => process.env.DONATION_URL ?? DEFAULT_DONATION_URL

/** GitHub Sponsors URL (env override: SPONSOR_URL) */
export const getSponsorUrl = (): string => process.env.SPONSOR_URL ?? DEFAULT_SPONSOR_URL

/** Support section of the website (env override: SUPPORT_PAGE_URL) */
export const getSupportPageUrl = (): string => process.env.SUPPORT_PAGE_URL ?? DEFAULT_SUPPORT_PAGE_URL
