import { getBindings } from "../../api";
import { TrainingPeaksAppConnection } from "../../apps/trainingpeaks/TrainingPeaksAppConnection";
import { Injectable } from "../../base/decorators/Injection";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { TrainingPeaksDuplicateError } from "../../apps/base/api/trainingpeaks";
import { isBase64 } from "../../apps/base/api/trainingpeaks/utils";
import { ActivityDetails } from "../base";
import { ActivityUploadFactory } from "./factory";
import { IActivityUpload } from "./types";

const SUPPORTED_FORMATS = new Set(['tcx', 'fit'])

/**
 * If an activity exists already in TrainingPeaks, but the workout can not be found, the activity is still seen as uploaded.
 * The app only accepts a link with an id as successful upload
 */
const EXISTING_ACTIVITY = 'existing'

/**
 * Represents a service that can be used by Incyclist to upload an activity to TrainingPeaks
 *
 * @example
 * const trainingPeaks = new TrainingPeaksUpload()
 * trainingPeaks.upload(activity,'tcx')
 *
 * @class
 * @public
 */
@Singleton
export class TrainingPeaksUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized: boolean
    protected connection = new TrainingPeaksAppConnection()

    constructor() {
        super('TrainingPeaksUpload')
        this.isInitialized = false
        this.init()
    }

    init(): boolean {
        if (this.isInitialized)
            return true
        this.isInitialized = this.getTrainingPeaksAppConnection().init()
        return this.isInitialized
    }

    /**
     * Indicates whether the user has connected his Incyclist account to TrainingPeaks
     *
     * @returns {boolean} True if the user has stored a connection to TrainingPeaks
     */
    isConnected(): boolean {
        return this.getTrainingPeaksAppConnection().isConnected()
    }

    /**
     * Uploads an activity to TrainingPeaks.
     *
     * If the activity is uploaded successfully, the links property of the activity is updated with the activity_id and the url.
     * If the upload fails (e.g. because TrainingPeaks reports that this activity already exists), the links property is updated with the error message.
     *
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity (TCX or FIT).
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
    async upload(activity: ActivityDetails, format: string = 'TCX'): Promise<boolean> {

        if (!this.ensureInitialized()) {
            this.logEvent({ message: 'TrainingPeaks Upload skipped', reason: 'not initialized' })
            return false
        }

        if (!this.isConnected())
            return false

        try {
            const lcFormat = format.toLowerCase()
            this.logEvent({ message: 'TrainingPeaks Upload', format: lcFormat.toUpperCase() })

            const fileName = this.getActivityFile(activity, lcFormat)
            const data = await this.readFileAsBase64(fileName, lcFormat)

            const res = await this.getApi().upload({
                fileName: this.getUploadFileName(fileName, lcFormat),
                data,
                title: activity.title,
                type: 'bike'
            })
            this.logEvent({ message: 'TrainingPeaks Upload success', activityId: res.trainingPeaksId })

            this.setLink(activity, { activity_id: res.trainingPeaksId, url: this.getUrl() })
            return true
        }
        catch (err) {
            if (err instanceof TrainingPeaksDuplicateError)
                return await this.onDuplicate(activity)

            this.logEvent({ message: 'TrainingPeaks Upload failure', error: err.message })
            this.setLink(activity, { error: err.message })
            return false
        }
    }

    /**
     * TrainingPeaks confirmed that the activity exists already, so this is not a failure:
     * the activity is linked to the existing workout (if it can be found)
     */
    protected async onDuplicate(activity: ActivityDetails): Promise<boolean> {
        const id = await this.findExistingWorkout(activity)
        this.logEvent({ message: 'TrainingPeaks Upload duplicate', activityId: id, found: id !== undefined })

        this.setLink(activity, id
            ? { activity_id: id, url: this.getUrl() }
            : { activity_id: EXISTING_ACTIVITY, url: this.getUrl() })
        return true
    }

    protected async findExistingWorkout(activity: ActivityDetails): Promise<string | undefined> {
        try {
            const start = new Date(activity.startTime)
            if (Number.isNaN(start.valueOf()))
                return undefined

            const workout = await this.getApi().findWorkout(start)
            return workout ? String(workout.Id) : undefined
        }
        catch (err) {
            this.logEvent({ message: 'TrainingPeaks Upload duplicate: workout not found', error: err.message })
            return undefined
        }
    }

    /**
     * Returns the URL that is used to link an uploaded activity.
     *
     * TrainingPeaks does not support links to a single workout (or to a date of the calendar), so this is the URL of the calendar
     *
     * @returns {string} The URL of the calendar on TrainingPeaks.
     */
    getUrl(): string {
        return this.getApi().getCalendarUrl()
    }

    protected getActivityFile(activity: ActivityDetails, format: string): string {
        if (!SUPPORTED_FORMATS.has(format))
            throw new Error(`format ${format.toUpperCase()} is not supported by TrainingPeaks`)

        const fileName = activity[`${format}FileName`]
        if (!fileName)
            throw new Error(`no ${format.toUpperCase()} file available for this activity`)

        return fileName
    }

    protected async readFileAsBase64(fileName: string, format: string): Promise<string> {
        const fs = this.getFileSystem()
        if (!(await fs.existsFile(fileName)))
            throw new Error('activity file not found')

        // the platform encodes the file: a base64 string is safe for binary files and for the transfer between the processes of the desktop app
        const content = await fs.readFile(fileName, 'base64')
        if (!content)
            throw new Error('activity file is empty')

        const base64 = this.toBase64(content, format)
        const contentType = this.getContentType(content)
        const isXml = format === 'fit' ? undefined : this.isXml(base64)

        // the type is logged (never the content), as it depends on the binding of the platform
        this.logEvent({ message: 'TrainingPeaks Upload file', contentType, bytes: Math.floor(base64.length * 3 / 4), isXml })

        // fail with a meaningful message instead of an upload that TrainingPeaks is not able to process
        if (isXml === false)
            throw new Error(`activity file does not contain xml (content type: ${contentType})`)

        return base64
    }

    protected getContentType(content: unknown): string {
        if (typeof content !== 'object' || content === null)
            return typeof content
        return content.constructor?.name ?? 'object'
    }

    /**
     * Converts the content delivered by the fs binding to base64.
     *
     * The binding is asked for base64, so normally this is a string that can be used as it is. If a binding does not apply the
     * requested encoding, the content is converted: text is encoded, binary data (Buffer, Uint8Array, ...) is converted explicitly
     * (`Uint8Array.toString('base64')` does not encode base64, it returns the list of the bytes).
     */
    protected toBase64(content: unknown, format: string): string {
        if (typeof content === 'string') {
            const compact = content.replaceAll(/\s/g, '')
            if (isBase64(compact))
                return compact

            // text that was not encoded. A binary file can only be uploaded if the binding delivered it unmodified
            if (format === 'fit')
                throw new Error('binary file could not be read')
            return Buffer.from(content, 'utf-8').toString('base64')
        }

        return this.toBuffer(content).toString('base64')
    }

    protected toBuffer(content: unknown): Buffer {
        if (ArrayBuffer.isView(content))
            return Buffer.from(content.buffer, content.byteOffset, content.byteLength)

        if (content instanceof ArrayBuffer)
            return Buffer.from(content)

        // a Buffer that was serialized as JSON
        const serialized = content as { type?: string, data?: Array<number> }
        if (serialized?.type === 'Buffer' && Array.isArray(serialized.data))
            return Buffer.from(serialized.data)

        throw new Error('activity file has an unsupported content type')
    }

    protected isXml(base64: string): boolean {
        // 88 characters = the first 66 bytes (a multiple of 4 characters is required to decode a part)
        return Buffer.from(base64.substring(0, 88), 'base64').toString('utf-8').trimStart().startsWith('<')
    }

    /**
     * TrainingPeaks does not accept file names that contain any of `/ \ ? % * : | " < >` or a space
     * (the name needs to have an extension, the only dot that is allowed)
     */
    protected getUploadFileName(fileName: string, format: string): string {
        const name = fileName.split(/[\\/]/).at(-1) ?? ''
        const dot = name.lastIndexOf('.')
        const base = (dot >= 0 ? name.substring(0, dot) : name).replaceAll(/[\\/?%*:|"<>.\s]/g, '_')

        return `${base || 'activity'}.${format}`
    }

    protected setLink(activity: ActivityDetails, link: { activity_id?: string, url?: string, error?: string }) {
        activity.links = { ...activity.links, trainingpeaks: link }
    }

    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }

    @Injectable
    // istanbul ignore next
    protected getTrainingPeaksAppConnection() {
        return this.connection
    }

    @Injectable
    // istanbul ignore next
    protected getFileSystem() {
        return getBindings().fs
    }

    protected getApi() {
        return this.getTrainingPeaksAppConnection().getApi()
    }
}

const factory = new ActivityUploadFactory()
factory.add('trainingpeaks', new TrainingPeaksUpload())
