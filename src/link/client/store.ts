import { getBindings } from '../../api/bindings'
import { JsonRepository } from '../../api/repository'
import type { JSONObject } from '../../utils/xml'
import type { LinkAddress, LinkProtocolVersion, LinkRecord } from '../types'
import { LINKS_REPOSITORY, MAX_LOCAL_NAME_LENGTH, SECRET_KEY_PREFIX } from './consts'

/** The part of the JSON repository the store needs. */
export type LinkRepo = Pick<JsonRepository, 'read' | 'write' | 'delete' | 'list'>

const isVersion = (v: unknown): v is LinkProtocolVersion => {
    const version = v as LinkProtocolVersion
    return Number.isInteger(version?.major) && Number.isInteger(version?.minor)
}

const isAddress = (a: unknown): a is LinkAddress => {
    const address = a as LinkAddress
    return typeof address?.host === 'string' && Number.isInteger(address?.controlPort)
}

/** Returns the record if the stored object has the shape of a {@link LinkRecord}, otherwise `undefined`. */
export const toLinkRecord = (data: unknown): LinkRecord | undefined => {
    const d = data as Partial<LinkRecord>
    if (typeof d?.linkId !== 'string' || typeof d.name !== 'string' || !isVersion(d.protocolVersion) || typeof d.pairedAt !== 'number')
        return undefined
    const record: LinkRecord = { linkId: d.linkId, name: d.name, protocolVersion: d.protocolVersion, pairedAt: d.pairedAt }
    if (typeof d.localName === 'string' && d.localName)
        record.localName = d.localName
    if (isAddress(d.lastAddress))
        record.lastAddress = { host: d.lastAddress.host, controlPort: d.lastAddress.controlPort }
    if (typeof d.lastSeenAt === 'number')
        record.lastSeenAt = d.lastSeenAt
    if (typeof d.catalogVersion === 'string')
        record.catalogVersion = d.catalogVersion
    return record
}

/** Normalises a user-entered local name: control characters removed, length capped; empty resets to `undefined`. */
export const cleanLocalName = (name: unknown): string | undefined => {
    if (typeof name !== 'string')
        return undefined
    // eslint-disable-next-line no-control-regex
    const cleaned = Array.from(name.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, MAX_LOCAL_NAME_LENGTH).join('').trim()
    return cleaned || undefined
}

/**
 * Persistence of the paired computers: one {@link LinkRecord} per computer in the `links`
 * repository, and the pairing secret in secure storage under `localLink.secret.<linkId>`.
 * A secret is never written to the repository or to the user settings, and records are kept in
 * memory after {@link load}.
 */
export class LinkStore {
    protected records = new Map<string, LinkRecord>()

    constructor(protected repo: LinkRepo = JsonRepository.create(LINKS_REPOSITORY)) {}

    /** true if the platform offers secure storage; without it no secret can be kept and nothing can be paired */
    isSecretStorageAvailable(): boolean {
        return getBindings()?.secureStorage !== undefined
    }

    /** Reads every record. Unreadable or malformed objects are skipped. */
    async load(): Promise<void> {
        this.records.clear()
        const names = await this.repo.list() ?? []
        for (const name of names) {
            const record = toLinkRecord(await this.repo.read(name).catch(() => undefined))
            if (record)
                this.records.set(record.linkId, record)
        }
    }

    getAll(): LinkRecord[] {
        return [...this.records.values()].sort((a, b) => a.pairedAt - b.pairedAt)
    }

    get(linkId: string): LinkRecord | undefined {
        return this.records.get(linkId)
    }

    /** Stores or replaces a record; the in-memory copy is updated even if the write fails. */
    async save(record: LinkRecord): Promise<boolean> {
        this.records.set(record.linkId, { ...record })
        return await this.repo.write(record.linkId, { ...record } as unknown as JSONObject)
    }

    /** Applies a change to a stored record and persists it. */
    async update(linkId: string, change: Partial<Omit<LinkRecord, 'linkId'>>): Promise<LinkRecord | undefined> {
        const current = this.records.get(linkId)
        if (!current)
            return undefined
        const next: LinkRecord = { ...current, ...change }
        for (const key of Object.keys(change) as Array<keyof typeof change>) {
            if (change[key] === undefined)
                delete next[key]
        }
        await this.save(next)
        return next
    }

    /** Deletes the record and the secret of a computer. */
    async remove(linkId: string): Promise<void> {
        this.records.delete(linkId)
        await this.repo.delete(linkId).catch(() => false)
        await this.deleteSecret(linkId)
    }

    async getSecret(linkId: string): Promise<string | undefined> {
        try {
            return await getBindings()?.secureStorage?.get(SECRET_KEY_PREFIX + linkId)
        }
        catch {
            return undefined
        }
    }

    async saveSecret(linkId: string, secret: string): Promise<boolean> {
        try {
            return await getBindings()?.secureStorage?.set(SECRET_KEY_PREFIX + linkId, secret) === true
        }
        catch {
            return false
        }
    }

    async deleteSecret(linkId: string): Promise<boolean> {
        try {
            return await getBindings()?.secureStorage?.delete(SECRET_KEY_PREFIX + linkId) === true
        }
        catch {
            return false
        }
    }
}
