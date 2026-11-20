import knownServers from './known-servers.json'
import type { KnownRouteServer } from './types'

/**
 * The bundled list of known route servers. It is data only (`known-servers.json`), so adding or
 * removing an entry never requires a code change.
 */
export const getKnownRouteServers = (): Array<KnownRouteServer> => {
    return (knownServers as Array<KnownRouteServer>).map(s => ({ ...s }))
}
