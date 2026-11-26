import { getBindings } from "../api"

/**
 * Brings a local `file://` or `video://` URL with a Windows drive-letter path into its canonical form
 * with exactly three slashes (`file:///C:\\videos\\a.mp4`): the path of a drive-letter URL has no leading
 * `/` of its own, so the scheme has to bring the third one. `file://C:\\...` would make `C:` the host.
 * Applies on Windows only. On every other platform, and for every other URL (POSIX, relative, other
 * schemes), the URL is returned as it is.
 */
export const normalizeFileUrl = (url?: string): string | undefined => {
    if (!isWindows())
        return url
    return url?.replace(/^(file|video):\/\/+(?=[A-Za-z]:(?:[\\/%]|$))/, '$1:///')
}

export const isWindows = (): boolean => getBindings().appInfo?.getOS?.()?.platform === 'win32'
