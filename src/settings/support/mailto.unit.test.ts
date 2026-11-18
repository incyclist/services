import { buildSupportEmail } from './mailto'

describe('buildSupportEmail', () => {
    const input = { address: 'support@incyclist.com', uuid: '1f3a9c0e-5d1b-4e7a-9a3c-2c8e0f4b77b2', appVersion: '1.2.3', uiVersion: '26.10.1' }

    test('encodes line breaks as %0D%0A and spaces as %20', () => {
        const res = buildSupportEmail(input)
        expect(res.url).toContain('%0D%0A')
        expect(res.url).toContain('%20')
        expect(res.url).not.toContain('+')
        expect(res.url).not.toContain('%0A%0A')
        expect(res.url.startsWith('mailto:support@incyclist.com?subject=Incyclist%20support%20request&body=')).toBe(true)
    })

    test('details block contains uuid and both versions', () => {
        const res = buildSupportEmail(input)
        expect(res.body).toContain(`uuid: ${input.uuid}`)
        expect(res.body).toContain('App version: 1.2.3')
        expect(res.body).toContain('UI version: 26.10.1')
        expect(res.body.split('\r\n')[0]).toBe('Hello,')
    })

    test('copyText starts with address and subject', () => {
        const res = buildSupportEmail(input)
        expect(res.copyText).toBe(`To: support@incyclist.com\r\nSubject: Incyclist support request\r\n\r\n${res.body}`)
    })

    test('url stays below 2000 characters', () => {
        expect(buildSupportEmail(input).url.length).toBeLessThan(2000)
    })

    test('invalid address falls back to the default address', () => {
        const res = buildSupportEmail({ ...input, address: 'bad address&x=1' })
        expect(res.url).toBe('mailto:support@incyclist.com')
        expect(res.address).toBe('support@incyclist.com')
    })
})
