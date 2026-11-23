/**
 * Simulates the Hermes/React Native behaviour of Buffer: `subarray()` and `slice()` return a
 * plain `Uint8Array`, so Buffer methods (`equals`, `readUInt8`, `copy`, `toString('hex')`, ...)
 * do not exist on derived buffers. Returns a function that restores the original methods.
 */
export const simulateHermesBuffer = (): (() => void) => {
    const proto = Buffer.prototype as unknown as Record<string, unknown>
    const origSubarray = proto.subarray
    const origSlice = proto.slice
    const plain = function (this: Uint8Array, start?: number, end?: number): Uint8Array {
        return Uint8Array.prototype.subarray.call(new Uint8Array(this.buffer, this.byteOffset, this.length), start, end)
    }
    proto.subarray = plain
    proto.slice = plain
    return () => {
        proto.subarray = origSubarray
        proto.slice = origSlice
    }
}
