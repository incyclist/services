declare module '@garmin/fitsdk' {
    /** Encodes FIT messages into a binary FIT file. */
    export class Encoder {
        constructor(options?: { fieldDescriptions?: Record<string, unknown> })
        /** Encodes a message by mesg number and data object. */
        onMesg(mesgNum: number, mesg: Record<string, unknown>): this
        /** Encodes a message including mesgNum inside the data object. */
        writeMesg(mesg: Record<string, unknown> & { mesgNum: number }): this
        /** Finalises the file and returns the encoded bytes. */
        close(): Uint8Array
    }

    /** Decodes binary FIT data from a Stream. */
    export class Decoder {
        constructor(stream: Stream)
        isFIT(): boolean
        checkIntegrity(): boolean
        read(options?: Record<string, unknown>): { messages: Record<string, unknown[]>, errors: Error[] }
        static isFIT(stream: Stream): boolean
    }

    /** Binary stream over FIT data. */
    export class Stream {
        get length(): number
        static fromByteArray(bytes: number[]): Stream
        static fromArrayBuffer(buffer: ArrayBuffer): Stream
        static fromBuffer(buffer: Buffer): Stream
    }

    export const Profile: {
        MesgNum: Record<string, number>
        types: { 
            mesgNum: Record<number, string> 
            sport: Record<number, string> 
            manufacturer: Record<number, string> 
            garminProduct: Record<number, string> 
        }
    }

    export const Utils: {
        /** Milliseconds between Unix epoch and FIT epoch (1989-12-31 UTC). */
        FIT_EPOCH_MS: number
        convertDateTimeToDate(fitDateTime: number): Date
    }
}
