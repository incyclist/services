import { KnownDeviceNames } from './types'

/**
 * Name parts of the trainers and sensors our users ride with. The WebBLE binding of the desktop app never puts a device
 * with such a name on its failed list just because it did not respond (it is still blocked when it reports to be
 * of an unsupported kind). Maintained by hand, see README.md.
 *
 * **Increase `version` with every change.**
 */
export const KNOWN_DEVICE_NAMES: KnownDeviceNames = {
    version: 1,
    names: [
        '808s',
        'amazfit',
        'assioma*',
        'bk6*',
        'bkool*',
        'bryton',
        'cad',
        'cog',
        'coros',
        'cycplus',
        'd500v2',
        'direto',
        'fenix',
        'fit3',
        'forerunner',
        'g1mplus*',
        'h6m',
        'hammer',
        'hr50',
        'hrm*',
        'hw9',
        'iconsole',
        'jficcycle',
        'kickr',
        'kwikwi',
        'mrk',
        'neo',
        'polar',
        'spd',
        'stryd*',
        'suito',
        'tacx',
        'think',
        'tickr',
        'toputure',
        'trackr',
        'tuo',
        'vanrysel',
        'victory',
        'voactiv',
        'volt',
        'wahoo',
        'whoop',
        'xoss',
        'yesoul',
        'zwift',
        'zycle*',
    ],
}
