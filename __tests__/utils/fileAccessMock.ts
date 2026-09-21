import type { IFileAccessBinding } from '../../src/api/fileAccess/types'

export type FileAccessBindingMock = {
    [K in keyof IFileAccessBinding]: jest.Mock
}

/**
 * A fully mocked `IFileAccessBinding`, with every method a jest.Mock and sensible defaults:
 * supported, everything readable, nothing in the cloud, no grants.
 *
 * Override individual methods per test, e.g.
 *   const binding = createFileAccessBindingMock({ isSupported: jest.fn().mockReturnValue(false) })
 * or
 *   binding.getAvailability.mockResolvedValue({ isUbiquitous:true, ... })
 *
 * To test the "binding absent" case, don't use this at all - leave `getBindings().fileAccess`
 * undefined.
 */
export const createFileAccessBindingMock = (
    overrides: Partial<FileAccessBindingMock> = {}
): FileAccessBindingMock & IFileAccessBinding => {
    const mock: FileAccessBindingMock = {
        isSupported: jest.fn().mockReturnValue(true),
        classifyLocation: jest.fn().mockReturnValue('on-device'),

        activateGrant: jest.fn().mockResolvedValue({ resolvedPath: '/', isStale: false }),
        deactivateGrant: jest.fn().mockResolvedValue(undefined),
        captureGrant: jest.fn().mockResolvedValue(undefined),
        checkAccess: jest.fn().mockResolvedValue({ state: 'readable' }),

        getAvailability: jest.fn().mockResolvedValue({
            isUbiquitous: false,
            isDownloading: false,
            downloadRequested: false
        }),
        startDownload: jest.fn().mockResolvedValue(undefined),
        evict: jest.fn().mockResolvedValue(undefined),
        isCloudIdentityAvailable: jest.fn().mockResolvedValue(undefined),

        getPrivateDir: jest.fn().mockResolvedValue('/private/previews'),
        copyFile: jest.fn().mockResolvedValue(undefined)
    }

    return { ...mock, ...overrides } as FileAccessBindingMock & IFileAccessBinding
}
