/**
 * The list of name parts of known trainers and sensors, maintained by hand (see README.md in this folder).
 */
export interface KnownDeviceNames {
    /** increased with every change of `names`: consumers clean up what they stored about devices if it is higher than the one they know */
    version: number

    /**
     * Lower case parts of device names, sorted. A part matches a device whose name contains a part equal to it. An entry
     * that ends with `*` is a family and matches every part that starts with it ("hrm*": hrm, hrm200, hrmpro).
     */
    names: string[]
}
