const SECOND_LEVEL_DOMAINS = ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * Derives a name suggestion from the host of an address, e.g. `videos.alpine-club.org` -> `Alpine Club`,
 * `nas.local` -> `Nas`. An IP address gives no suggestion.
 *
 * The result still has to pass the name rules before it is offered.
 */
export const suggestServerName = (host: string): string | undefined => {
    if (!host)
        return undefined

    // port, IPv6 brackets
    const hostname = host.toLowerCase().replace(/:\d*$/, '')
    if (hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname))
        return undefined

    const labels = hostname.split('.').filter(l => l.length > 0)
    if (labels.length > 1)
        labels.pop()                                   // top level domain
    if (labels.length > 1 && SECOND_LEVEL_DOMAINS.includes(labels.at(-1)))
        labels.pop()                                   // co.uk, com.au, ...

    const name = labels.at(-1)
    if (!name)
        return undefined

    return name.split('-').filter(w => w.length > 0).map(capitalize).join(' ')
}

/** formats a size in bytes as e.g. '1.2 GB' */
export const formatSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    const digits = unit === 0 || value >= 100 ? 0 : 1
    return `${value.toFixed(digits)} ${units[unit]}`
}
