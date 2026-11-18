import { EMAIL_COPY } from './copy'
import { DEFAULT_SUPPORT_EMAIL } from './urls'

const EOL = '\r\n'
const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/

export type SupportEmailInput = {
    address: string
    uuid?: string | null
    appVersion?: string
    uiVersion?: string
}

export type SupportEmail = {
    address: string
    subject: string
    body: string
    copyText: string
    url: string
}

const buildBody = ({ uuid, appVersion, uiVersion }: SupportEmailInput): string => {
    const lines = [
        EMAIL_COPY.greeting,
        '',
        EMAIL_COPY.prompt,
        '', '', '', '',
        EMAIL_COPY.divider,
        EMAIL_COPY.keepNote,
        `${EMAIL_COPY.uuidLabel}: ${uuid ?? ''}`,
        `${EMAIL_COPY.appVersionLabel}: ${appVersion ?? ''}`,
        `${EMAIL_COPY.uiVersionLabel}: ${uiVersion ?? ''}`,
    ]
    return lines.join(EOL)
}

/**
 * Builds the prefilled support email: subject, body (with the details block), the text used by
 * Copy/Share details and the encoded mailto URL.
 *
 * If the address is not a plain address, the default support address is used instead
 * (subject and body are kept).
 */
export const buildSupportEmail = (input: SupportEmailInput): SupportEmail => {
    const valid = PLAIN_ADDRESS.test(input.address ?? '')
    const address = valid ? input.address : DEFAULT_SUPPORT_EMAIL
    const subject = EMAIL_COPY.subject
    const body = buildBody(input)
    const copyText = `To: ${address}${EOL}Subject: ${subject}${EOL}${EOL}${body}`

    const url = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

    return { address, subject, body, copyText, url }
}
