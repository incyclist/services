import { getBindings } from '../../api'
import { TrainerDayAppConnection } from '../../apps/trainerday/TrainerDayAppConnection'
import { Injectable } from '../../base/decorators/Injection'
import { IncyclistService } from '../../base/service'
import { Singleton } from '../../base/types'
import { ActivityDetails } from '../base'
import { ActivityUploadFactory } from './factory'
import { IActivityUpload } from './types'

/**
 * Base URL that is used to link an uploaded activity: `<base>/<id>`, where the id is the one returned by the upload
 * (the web app resolves it to the activity)
 */
export const TRAINERDAY_ACTIVITY_URL = 'https://app.trainerday.com/activities'

type TrainerDayFormat = 'tcx' | 'fit'

const SUPPORTED_FORMATS = new Set<string>(['tcx', 'fit'])
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Represents a service that can be used by Incyclist to upload an activity to TrainerDay
 *
 * TrainerDay does not detect duplicates: uploading the same file twice creates two activities.
 * Whether an activity is uploaded (again) is decided by the caller, based on `activity.links.trainerday`.
 *
 * @example
 * const trainerDay = new TrainerDayUpload()
 * trainerDay.upload(activity,'tcx')
 *
 * @class
 * @public
 */
@Singleton
export class TrainerDayUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized: boolean
    protected connection = new TrainerDayAppConnection()

    constructor() {
        super('TrainerDayUpload')
        this.isInitialized = false
        this.init()
    }

    init(): boolean {
        if (this.isInitialized)
            return true
        this.isInitialized = this.getTrainerDayAppConnection().init()
        return this.isInitialized
    }

    /**
     * Indicates whether the user has connected his Incyclist account to TrainerDay
     *
     * @returns {boolean} True if the user has stored a connection to TrainerDay
     */
    isConnected(): boolean {
        return this.getTrainerDayAppConnection().isConnected()
    }

    /**
     * Uploads an activity to TrainerDay.
     *
     * If the activity is uploaded successfully, the links property of the activity is updated with the activity_id and the url.
     * If the upload fails, the links property is updated with the error message.
     *
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity (TCX or FIT).
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
    async upload(activity: ActivityDetails, format: string = 'TCX'): Promise<boolean> {

        if (!this.ensureInitialized()) {
            this.logEvent({ message: 'TrainerDay Upload skipped', reason: 'not initialized' })
            return false
        }

        if (!this.isConnected())
            return false

        try {
            const lcFormat = format.toLowerCase()
            this.logEvent({ message: 'TrainerDay Upload', format: lcFormat.toUpperCase() })

            const dataType = this.getDataType(lcFormat)
            const fileName = this.getActivityFile(activity, lcFormat)
            const data = await this.readFile(fileName, dataType)

            const res = await this.getApi().uploadActivity({
                name: this.getName(activity),
                dataType,
                data,
                externalId: activity.id,
                sportType: activity.sport === 'rowing' ? undefined : 'bike'
            })

            const activityId = res?.activityId === undefined || res.activityId === null ? '' : String(res.activityId)
            if (!activityId)
                throw new Error('TrainerDay did not return an activity id')

            this.logEvent({ message: 'TrainerDay Upload success', activityId })
            this.setLink(activity, { activity_id: activityId, url: this.getUrl(activityId) })
            return true
        }
        catch (err) {
            const error = err?.message ?? String(err)
            this.logEvent({ message: 'TrainerDay Upload failure', error })
            this.setLink(activity, { error })
            return false
        }
    }

    /**
     * Returns the URL that is used to link an uploaded activity.
     *
     * @param {string} activityId - The id of the activity on TrainerDay, as returned by the upload.
     * @returns {string} The URL of the activity on TrainerDay.
     */
    getUrl(activityId: string): string {
        return `${TRAINERDAY_ACTIVITY_URL}/${activityId}`
    }

    protected getDataType(format: string): TrainerDayFormat {
        if (!SUPPORTED_FORMATS.has(format))
            throw new Error(`format ${format.toUpperCase()} is not supported by TrainerDay`)
        return format as TrainerDayFormat
    }

    protected getActivityFile(activity: ActivityDetails, format: string): string {
        const fileName = activity[`${format}FileName`]
        if (!fileName)
            throw new Error(`no ${format.toUpperCase()} file available for this activity`)

        return fileName
    }

    protected getName(activity: ActivityDetails): string {
        const title = activity.title?.trim()
        if (title)
            return title

        const routeName = (activity.route?.title ?? activity.route?.name)?.trim()
        if (routeName)
            return routeName

        const start = new Date(activity.startTime)
        return Number.isNaN(start.valueOf()) ? 'Incyclist ride' : `Incyclist ride ${start.toISOString().substring(0, 10)}`
    }

    protected async readFile(fileName: string, format: TrainerDayFormat): Promise<string | Uint8Array> {
        const fs = this.getFileSystem()
        if (!(await fs.existsFile(fileName)))
            throw new Error('activity file not found')

        // the platform encodes the file: a base64 string is safe for binary files and for the transfer between the processes of the desktop app
        const content = await fs.readFile(fileName, 'base64')
        if (!content)
            throw new Error('activity file is empty')

        const contentType = this.getContentType(content)
        const data = this.toData(content, format)
        const isXml = format === 'fit' ? undefined : this.isXml(data)

        // the type is logged (never the content), as it depends on the binding of the platform
        this.logEvent({ message: 'TrainerDay Upload file', contentType, bytes: this.getSize(data), isXml })

        if (isXml === false)
            throw new Error(`activity file does not contain xml (content type: ${contentType})`)

        return data
    }

    protected getContentType(content: unknown): string {
        if (typeof content !== 'object' || content === null)
            return typeof content
        return content.constructor?.name ?? 'object'
    }

    /**
     * Converts the content delivered by the fs binding to something that the API accepts: a base64 string or the bytes.
     *
     * The binding is asked for base64, so normally this is a string that can be used as it is. If a binding does not apply the
     * requested encoding, the content is converted explicitly (`Uint8Array.toString('base64')` returns the list of bytes).
     */
    protected toData(content: unknown, format: TrainerDayFormat): string | Uint8Array {
        if (typeof content === 'string') {
            const compact = content.replaceAll(/\s/g, '')
            if (compact.length % 4 === 0 && BASE64_PATTERN.test(compact))
                return compact

            // text that was not encoded. A binary file can only be uploaded if the binding delivered it unmodified
            if (format === 'fit')
                throw new Error('binary file could not be read')
            return new TextEncoder().encode(content)
        }

        return this.toBytes(content)
    }

    protected toBytes(content: unknown): Uint8Array {
        if (ArrayBuffer.isView(content))
            return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)

        if (content instanceof ArrayBuffer)
            return new Uint8Array(content)

        // a Buffer that was serialized as JSON
        const serialized = content as { type?: string, data?: Array<number> }
        if (serialized?.type === 'Buffer' && Array.isArray(serialized.data))
            return Uint8Array.from(serialized.data)

        throw new Error('activity file has an unsupported content type')
    }

    protected getSize(data: string | Uint8Array): number {
        return typeof data === 'string' ? Math.floor(data.length * 3 / 4) : data.byteLength
    }

    protected isXml(data: string | Uint8Array): boolean {
        // 88 characters = the first 66 bytes (a multiple of 4 characters is required to decode a part)
        const head = typeof data === 'string'
            ? Buffer.from(data.substring(0, 88), 'base64')
            : data.subarray(0, 66)
        return new TextDecoder('utf-8').decode(head).replace(/^\u{FEFF}/u, '').trimStart().startsWith('<')
    }

    protected setLink(activity: ActivityDetails, link: { activity_id?: string, url?: string, error?: string }) {
        activity.links = { ...activity.links, trainerday: link }
    }

    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }

    @Injectable
    // istanbul ignore next
    protected getTrainerDayAppConnection() {
        return this.connection
    }

    @Injectable
    // istanbul ignore next
    protected getFileSystem() {
        return getBindings().fs
    }

    protected getApi() {
        return this.getTrainerDayAppConnection().getApi()
    }
}

const factory = new ActivityUploadFactory()
factory.add('trainerday', new TrainerDayUpload())
