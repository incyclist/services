import {
    buildDisplayPath, canonicalPath, isRemoteUrl, isSamePathOrBelow, lowestCommonAncestor, parentFolder
} from './utils'

describe('fileaccess utils', () => {

    describe('canonicalPath', () => {

        test('strips a file URL scheme and keeps the leading separator', () => {
            expect(canonicalPath('file:///var/mobile/Videos/route.mp4')).toBe('/var/mobile/Videos/route.mp4')
        })

        test('strips the video URL scheme used for imported videos', () => {
            expect(canonicalPath('video:///var/mobile/Videos/route.mp4')).toBe('/var/mobile/Videos/route.mp4')
        })

        test('decodes percent escapes', () => {
            expect(canonicalPath('file:///var/mobile/My%20Videos/Route%20A.mp4'))
                .toBe('/var/mobile/My Videos/Route A.mp4')
        })

        test('keeps a literal percent that is not an escape sequence', () => {
            expect(canonicalPath('/var/mobile/100%/route.mp4')).toBe('/var/mobile/100%/route.mp4')
        })

        test('collapses duplicate separators', () => {
            expect(canonicalPath('/var//mobile///Videos/route.mp4')).toBe('/var/mobile/Videos/route.mp4')
        })

        test('strips a trailing separator', () => {
            expect(canonicalPath('/var/mobile/Videos/')).toBe('/var/mobile/Videos')
        })

        test('keeps the root path', () => {
            expect(canonicalPath('/')).toBe('/')
        })

        test('folds /private/var onto /var', () => {
            expect(canonicalPath('/private/var/mobile/Videos')).toBe('/var/mobile/Videos')
            expect(canonicalPath('/private/var')).toBe('/var')
        })

        test('does not fold a folder that merely starts with the same characters', () => {
            expect(canonicalPath('/private/variants/x')).toBe('/private/variants/x')
        })

        test('the two spellings of the same folder canonicalize identically', () => {
            expect(canonicalPath('file:///private/var/mobile/My%20Videos/'))
                .toBe(canonicalPath('/var/mobile/My Videos'))
        })

        test('normalizes unicode to NFC', () => {
            const decomposed = '/var/mobile/Vide\u0301os'
            expect(canonicalPath(decomposed)).toBe('/var/mobile/Vid\u00e9os'.normalize('NFC'))
        })

        test('returns undefined for remote URLs', () => {
            expect(canonicalPath('https://incyclist.com/video.mp4')).toBeUndefined()
            expect(canonicalPath('http://incyclist.com/video.mp4')).toBeUndefined()
            expect(canonicalPath('content://com.android.providers/1')).toBeUndefined()
        })

        test('returns undefined for empty input', () => {
            expect(canonicalPath(undefined)).toBeUndefined()
            expect(canonicalPath('')).toBeUndefined()
            expect(canonicalPath('   ')).toBeUndefined()
        })

        test('keeps a windows drive letter without a leading separator', () => {
            expect(canonicalPath('file:///D:/RLV/route.avi')).toBe('D:/RLV/route.avi')
        })
    })

    describe('isRemoteUrl', () => {
        test('recognizes remote schemes', () => {
            expect(isRemoteUrl('https://x/y')).toBe(true)
            expect(isRemoteUrl('content://x/y')).toBe(true)
        })
        test('a local path is not remote', () => {
            expect(isRemoteUrl('/var/x')).toBe(false)
            expect(isRemoteUrl('file:///var/x')).toBe(false)
            expect(isRemoteUrl(undefined)).toBe(false)
        })
    })

    describe('isSamePathOrBelow', () => {

        test('the folder itself is covered', () => {
            expect(isSamePathOrBelow('/var/Videos', '/var/Videos')).toBe(true)
        })

        test('a file below the folder is covered', () => {
            expect(isSamePathOrBelow('/var/Videos', '/var/Videos/A/route.mp4')).toBe(true)
        })

        test('matching stops at segment boundaries', () => {
            expect(isSamePathOrBelow('/var/Videos', '/var/Videos2/route.mp4')).toBe(false)
        })

        test('a parent is not covered by its child', () => {
            expect(isSamePathOrBelow('/var/Videos/A', '/var/Videos')).toBe(false)
        })

        test('missing arguments are never covered', () => {
            expect(isSamePathOrBelow(undefined, '/var/x')).toBe(false)
            expect(isSamePathOrBelow('/var', undefined)).toBe(false)
        })
    })

    describe('parentFolder', () => {
        test('returns the containing folder', () => {
            expect(parentFolder('/var/Videos/route.mp4')).toBe('/var/Videos')
        })
        test('returns the root for a top level entry', () => {
            expect(parentFolder('/var')).toBe('/')
        })
        test('the root has no parent', () => {
            expect(parentFolder('/')).toBeUndefined()
            expect(parentFolder(undefined)).toBeUndefined()
        })
    })

    describe('lowestCommonAncestor', () => {

        test('finds the deepest shared folder', () => {
            expect(lowestCommonAncestor(['/var/V/A', '/var/V/B'])).toBe('/var/V')
        })

        test('a single path is its own ancestor', () => {
            expect(lowestCommonAncestor(['/var/V/A'])).toBe('/var/V/A')
        })

        test('a nested path does not deepen the ancestor', () => {
            expect(lowestCommonAncestor(['/var/V', '/var/V/A/B'])).toBe('/var/V')
        })

        test('unrelated trees share only the root', () => {
            expect(lowestCommonAncestor(['/var/V/A', '/mnt/W/B'])).toBe('/')
        })

        test('ignores undefined entries', () => {
            expect(lowestCommonAncestor([undefined, '/var/V/A', undefined])).toBe('/var/V/A')
        })

        test('returns undefined when there is nothing to compare', () => {
            expect(lowestCommonAncestor([])).toBeUndefined()
            expect(lowestCommonAncestor([undefined])).toBeUndefined()
        })
    })

    describe('buildDisplayPath', () => {

        test('replaces the cloud container plumbing with the name the user sees', () => {
            const folder = '/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Videos/Alps'
            expect(buildDisplayPath(folder, 'icloud')).toBe('iCloud Drive › Videos › Alps')
        })

        test('shows the trailing folders of an on-device path', () => {
            expect(buildDisplayPath('/var/mobile/Containers/Data/Videos/Alps', 'on-device'))
                .toBe('Data › Videos › Alps')
        })

        test('returns an empty string without a folder', () => {
            expect(buildDisplayPath(undefined, 'icloud')).toBe('')
        })
    })
})
