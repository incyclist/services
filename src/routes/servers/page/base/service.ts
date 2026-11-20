import { Injectable } from '../../../../base/decorators'
import { IncyclistService } from '../../../../base/service'
import { Observer } from '../../../../base/types'
import type { IObserver } from '../../../../types'
import { useRouteList } from '../../../list/service'
import { getKnownRouteServers } from '../../known'
import { SERVER_MESSAGES as MSG } from '../../messages'
import { useRouteServerStatus } from '../../status'
import type { KnownRouteServer, RouteServerProbeResult } from '../../types'
import { RouteServerValidationError } from '../../errors'
import { normalizeRouteServerUrl, validateRouteServerUrl } from '../../validator'
import { formatSize, suggestServerName } from './utils'
import type {
    KnownServerItem, ManualEntryProps, ManualEntryState, RemoveServerDialogProps, RouteServerItem,
    RouteServersOrigin, RouteServersSettingsDisplayProps, RouteServersView
} from './types'

const SUCCESS_DELAY_MS = 1000

// codes that are worth showing while the user is still typing the address. Others ("not a web address",
// ...) would only be noise for an incomplete address and are reported when the address is submitted.
const LIVE_URL_ERRORS = ['whitespace', 'credentials', 'http-internet', 'http-not-supported', 'duplicate', 'built-in']

interface PendingServer {
    url: string
    routeCount: number
}

interface KnownState {
    state: 'checking' | 'error'
    error?: string
}

/**
 * Page logic of the "Route Servers" settings, shared by all platforms: the list of servers, the
 * add view (known servers and manual entry) and the remove dialog.
 *
 * The page service decides what is shown (display props, states, texts). The apps decide how it
 * is shown. Platform differences live in the overridable hooks.
 */
export abstract class RouteServersSettingsPageService extends IncyclistService {

    protected observer?: Observer
    protected origin: RouteServersOrigin = 'settings'
    protected view: RouteServersView = 'list'
    protected highlightKey?: string

    protected manualUrl = ''
    protected manualName = ''
    protected nameTouched = false
    protected suggestedName?: string
    protected manualState: ManualEntryState = 'idle'
    protected urlError?: string
    protected nameError?: string
    protected message?: string
    protected resolvedUrl?: string
    protected localNote?: string
    protected pending?: PendingServer
    // the address needs to be confirmed with 'add()' (two-step entry, or switched to http)
    protected reviewRequired = false

    protected knownStates: Map<string, KnownState> = new Map()
    protected knownCounts: Map<string, number> = new Map()
    protected removeDialog?: RemoveServerDialogProps
    protected removeKey?: string

    // incremented whenever a running manual check must not change the state any more (back, close, new input)
    protected checkToken = 0
    // incremented whenever the view is left (back, close, new add view): known servers that are being checked are dropped
    protected viewToken = 0
    protected successTimer?: ReturnType<typeof setTimeout>
    protected onStatusChanged = this.updatePage.bind(this)

    constructor() {
        super('RouteServersSettings')
    }

    // ----- platform hooks -----

    /** whether `http://` is accepted for servers on the home network on this platform */
    protected get allowsLocalHttp(): boolean {
        return true
    }

    /** an additional hint below an address that could not be reached */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected getUnreachableHint(_isHomeNetwork: boolean): string | undefined {
        return undefined
    }

    // ----- lifecycle -----

    /**
     * Opens the page. The returned observer emits `page-update` whenever the display props have changed.
     *
     * @param origin 'settings': opened from Settings, starts with the list. 'import': opened from the Import Routes dialog, starts with the add view
     */
    open(origin: RouteServersOrigin = 'settings'): IObserver {
        try {
            if (this.observer)
                this.close()

            this.resetState()
            this.origin = origin
            this.view = origin === 'import' ? 'add' : 'list'
            this.observer = new Observer()
            this.getRouteServerStatus().on('changed', this.onStatusChanged)

            this.logEvent({ message: 'route servers settings opened', origin })
            return this.observer
        }
        catch (err) {
            this.logError(err, 'open')
        }
    }

    close() {
        try {
            this.checkToken++
            this.viewToken++
            this.clearSuccessTimer()
            this.getRouteServerStatus().off('changed', this.onStatusChanged)

            const observer = this.observer
            delete this.observer
            observer?.emit('closed')
            observer?.stop()
            this.resetState()
        }
        catch (err) {
            this.logError(err, 'close')
        }
    }

    getPageObserver(): IObserver | undefined {
        return this.observer
    }

    // ----- navigation -----

    showAdd() {
        this.checkToken++
        this.viewToken++
        this.clearSuccessTimer()
        this.resetManual()
        this.knownStates.clear()
        this.view = 'add'
        this.updatePage()
    }

    /** phone: switches to the second step of the add view (manual entry) */
    showManualEntry() {
        this.view = 'add-manual'
        this.updatePage()
    }

    back() {
        this.checkToken++
        this.viewToken++
        this.clearSuccessTimer()

        if (this.view === 'add-manual') {
            this.view = 'add'
        }
        else if (this.view === 'add' && this.origin === 'settings') {
            this.view = 'list'
        }
        else {
            this.close()
            return
        }
        this.resetManual()
        this.updatePage()
    }

    // ----- known servers -----

    addKnown(id: string) {
        const entry = this.getKnownServers().find(k => k.id === id)
        if (!entry || this.isKnownAdded(entry) || this.knownStates.get(id)?.state === 'checking')
            return

        this.knownStates.set(id, { state: 'checking' })
        this.updatePage()

        this.checkAndAddKnown(entry)
            .catch(err => { this.logError(err, 'addKnown', { id }) })
    }

    retryKnown(id: string) {
        this.addKnown(id)
    }

    // ----- manual entry -----

    setManualUrl(url: string) {
        if (this.manualState === 'checking')
            return

        this.manualUrl = url ?? ''
        this.resetManualResult()

        const res = this.getRouteList().validateExternalApiProviderUrl(this.manualUrl, { allowsLocalHttp: this.allowsLocalHttp })
        if (res.valid) {
            this.localNote = this.manualUrl.trim().toLowerCase().startsWith('http://') && res.isUnencrypted ? MSG.localNote : undefined
        }
        else if (res.message && LIVE_URL_ERRORS.includes(res.code)) {
            this.urlError = res.message
        }

        this.updateSuggestion(res.valid ? res.host : undefined)
        this.validateNameLive()
        this.updatePage()
    }

    setManualName(name: string) {
        if (this.manualState === 'checking')
            return

        this.manualName = name ?? ''
        this.nameTouched = true
        if (this.manualState === 'error')
            this.manualState = 'idle'
        this.validateNameLive()
        this.updatePage()
    }

    /** one-step entry: checks the address and, if the name is valid, saves the server */
    checkAndAdd() {
        this.startCheck(false)
    }

    /** two-step entry (phone): checks the address and waits for `add()` */
    check() {
        this.startCheck(true)
    }

    /** saves the server after a successful check (state 'checked') */
    add() {
        if (this.manualState !== 'checked' || !this.pending)
            return

        if (!this.isNameValid()) {
            this.validateNameLive(true)
            this.updatePage()
            return
        }
        this.saveManual()
    }

    /** the server works, but has no routes: the user wants to add it anyway */
    confirmAddEmpty() {
        if (this.manualState !== 'confirm-empty' || !this.pending)
            return

        if (this.reviewRequired || !this.isNameValid()) {
            this.manualState = 'checked'
            this.message = MSG.found(0)
            this.updatePage()
            return
        }
        this.saveManual()
    }

    // ----- remove -----

    requestRemove(key: string) {
        const servers = this.getRouteList().getExternalApiProviders()
        if (!servers?.has(key))
            return

        const routeCount = this.getRouteList().getExternalApiProviderRouteCount(key)
        this.removeKey = key
        this.removeDialog = this.buildRemoveDialog(key, routeCount, false)
        this.updatePage()

        this.loadDownloadInfo(key, routeCount)
            .catch(err => { this.logError(err, 'requestRemove', { key }) })
    }

    setRemoveRoutes(remove: boolean) {
        if (!this.removeDialog)
            return
        const { key, routeCount, downloadedCount, downloadedSize } = this.removeDialog
        this.removeDialog = this.buildRemoveDialog(key, routeCount, remove, downloadedCount, downloadedSize)
        this.updatePage()
    }

    confirmRemove() {
        const dialog = this.removeDialog
        if (!dialog)
            return

        this.removeServer(dialog)
            .catch(err => { this.logError(err, 'confirmRemove', { key: dialog.key }) })
    }

    cancelRemove() {
        delete this.removeDialog
        delete this.removeKey
        this.updatePage()
    }

    // ----- display props -----

    /** Builds the display props from scratch, so they always reflect the current state of the route list */
    getPageDisplayProps(): RouteServersSettingsDisplayProps {
        const servers = this.buildServerItems()
        const known = this.buildKnownItems()
        const isEmpty = servers.length === 1   // only the built-in server

        const props: RouteServersSettingsDisplayProps = {
            view: this.view,
            origin: this.origin,
            servers,
            isEmpty,
            known,
            manual: this.buildManualProps(),
            trustNote: MSG.trustNote,
        }

        if (isEmpty)
            props.emptyState = { title: 'Get more routes from other providers', text: 'Some riders and groups host their own routes, mostly videos. Add their route server and its routes appear in your route list automatically.' }
        if (known.length > 0)
            props.knownNote = MSG.knownNote
        if (this.removeDialog)
            props.removeDialog = { ...this.removeDialog }
        if (this.highlightKey)
            props.highlightKey = this.highlightKey
        return props
    }

    // ----- protected helpers: list -----

    protected buildServerItems(): Array<RouteServerItem> {
        const items: Array<RouteServerItem> = [{
            key: 'Incyclist', name: 'Incyclist', isBuiltIn: true, status: 'ok',
            statusText: MSG.statusBuiltIn, canRemove: false
        }]

        const providers = this.getRouteList().getExternalApiProviders()
        if (!providers)
            return items

        const names = Array.from(providers.keys()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        names.forEach(name => { items.push(this.buildServerItem(name, providers.get(name))) })
        return items
    }

    protected buildServerItem(name: string, url: string): RouteServerItem {
        const list = this.getRouteList()
        const statusStore = this.getRouteServerStatus()

        const status = statusStore.getStatus(name)
        const listed = list.getExternalApiProviderRouteCount(name)
        const routeCount = listed > 0 ? listed : (statusStore.getResult(name)?.routeCount ?? 0)

        const item: RouteServerItem = {
            key: name, name, isBuiltIn: false, status, routeCount,
            statusText: this.getStatusText(status, routeCount), canRemove: true
        }

        // the entry itself is part of the configuration, so only the format rules are applied here
        // (a clash with another server is no reason to call an entry "outside the app")
        const address = validateRouteServerUrl(url, { allowsLocalHttp: this.allowsLocalHttp })
        item.host = this.getHost(url)

        if (address.valid) {
            item.isLocal = address.isLocal
            item.isUnencrypted = address.isUnencrypted
        }
        if (address.valid && address.isLocal)
            item.tag = address.isUnencrypted ? 'Local · not encrypted' : 'Local'

        if (!address.valid || !this.isNameAcceptable(name)) {
            item.addedOutsideApp = true
            item.note = 'Added outside the app'
        }
        return item
    }

    protected isNameAcceptable(name: string): boolean {
        const res = this.getRouteList().validateExternalApiProviderName(name)
        return res.valid || res.code === 'duplicate'
    }

    protected getHost(url: string): string {
        try {
            return new URL(url).host
        }
        catch {
            return url
        }
    }

    protected getStatusText(status: RouteServerItem['status'], count: number): string {
        switch (status) {
            case 'loading': return MSG.statusChecking
            case 'unreachable': return MSG.statusUnreachable
            case 'empty': return MSG.statusNoRoutes
            default: return count > 0 ? MSG.routes(count) : MSG.statusNoRoutes
        }
    }

    // ----- protected helpers: known servers -----

    protected buildKnownItems(): Array<KnownServerItem> {
        return this.getKnownServers().map(entry => {
            const item: KnownServerItem = { id: entry.id, name: entry.name, description: entry.description, state: 'available' }
            if (entry.operator)
                item.operator = entry.operator

            const added = this.findAddedName(entry)
            const state = this.knownStates.get(entry.id)
            if (added) {
                item.state = 'added'
                item.routeCount = this.knownCounts.get(entry.id) ?? this.getRouteList().getExternalApiProviderRouteCount(added)
            }
            else if (state) {
                item.state = state.state
                if (state.error)
                    item.error = state.error
            }
            return item
        })
    }

    /** name under which the server of a known entry is configured (matched by normalised url, not by name) */
    protected findAddedName(entry: KnownRouteServer): string | undefined {
        const providers = this.getRouteList().getExternalApiProviders()
        if (!providers)
            return undefined

        const target = normalizeRouteServerUrl(entry.url)
        return Array.from(providers.entries()).find(([, url]) => normalizeRouteServerUrl(url) === target)?.[0]
    }

    protected isKnownAdded(entry: KnownRouteServer): boolean {
        return this.findAddedName(entry) !== undefined
    }

    protected async checkAndAddKnown(entry: KnownRouteServer): Promise<void> {
        const token = this.viewToken
        const list = this.getRouteList()

        const name = list.validateExternalApiProviderName(entry.name)
        if (!name.valid) {
            this.setKnownError(entry.id, name.message)
            return
        }
        const address = list.validateExternalApiProviderUrl(entry.url, { allowsLocalHttp: false })
        if (!address.valid) {
            this.setKnownError(entry.id, address.message ?? MSG.urlNotAUrl)
            return
        }

        const probe = await list.probeExternalApiProvider(address.url)
        if (token !== this.viewToken)
            return
        if (!probe.ok) {
            this.setKnownError(entry.id, probe.message)
            return
        }

        try {
            const stored = list.addExternalApiProvider(name.name, address.url)
            this.knownStates.delete(entry.id)
            this.knownCounts.set(entry.id, probe.routeCount)
            this.startLoading(stored.name)
            this.logEvent({ message: 'known route server added', id: entry.id, routeCount: probe.routeCount })
        }
        catch (err) {
            this.setKnownError(entry.id, this.getErrorMessage(err))
            return
        }
        this.updatePage()
    }

    protected setKnownError(id: string, error: string) {
        this.knownStates.set(id, { state: 'error', error })
        this.logEvent({ message: 'known route server not added', id, error })
        this.updatePage()
    }

    // ----- protected helpers: manual entry -----

    protected startCheck(twoStep: boolean) {
        if (this.manualState === 'checking')
            return

        this.runCheck(twoStep)
            .catch(err => {
                this.logError(err, 'check')
                this.manualState = 'error'
                this.urlError = MSG.probeUnreachable
                this.updatePage()
            })
    }

    protected async runCheck(twoStep: boolean): Promise<void> {
        const list = this.getRouteList()
        this.resetManualResult()

        const address = list.validateExternalApiProviderUrl(this.manualUrl, { allowsLocalHttp: this.allowsLocalHttp })
        if (!address.valid) {
            this.urlError = address.message
            this.manualState = address.message ? 'error' : 'idle'
            this.updatePage()
            return
        }
        if (!twoStep && !this.isNameValid()) {
            this.validateNameLive(true)
            this.manualState = 'error'
            this.updatePage()
            return
        }

        const token = ++this.checkToken
        this.manualState = 'checking'
        this.updatePage()

        const probe = await list.probeExternalApiProvider(address.url, address.httpFallbackUrl)
        if (token !== this.checkToken)
            return

        if (!probe.ok) {
            this.onProbeFailed(probe, address.isLocal)
            return
        }
        this.onProbeSucceeded(probe, twoStep)
    }

    protected onProbeFailed(probe: RouteServerProbeResult, isHomeNetwork: boolean) {
        const hint = probe.code === 'unreachable' ? this.getUnreachableHint(isHomeNetwork) : undefined
        this.urlError = hint ? `${probe.message} ${hint}` : probe.message
        this.manualState = 'error'
        this.updatePage()
    }

    protected onProbeSucceeded(probe: RouteServerProbeResult, twoStep: boolean) {
        const url = probe.url
        this.pending = { url, routeCount: probe.routeCount }
        this.reviewRequired = twoStep || probe.switchedToHttp === true
        this.resolvedUrl = url
        if (url.startsWith('http:'))
            this.localNote = MSG.localNoteShort

        // the name is suggested again, so the user sees it before confirming (two-step entry)
        this.updateSuggestion(this.getHost(url))

        if (probe.routeCount === 0) {
            this.manualState = 'confirm-empty'
            this.message = MSG.emptyConfirm
        }
        else if (this.reviewRequired || !this.isNameValid()) {
            this.manualState = 'checked'
            this.message = MSG.found(probe.routeCount)
        }
        else {
            this.saveManual()
            return
        }
        this.updatePage()
    }

    protected saveManual() {
        const pending = this.pending
        if (!pending)
            return

        try {
            const stored = this.getRouteList().addExternalApiProvider(this.manualName, pending.url)
            this.manualState = 'success'
            this.message = MSG.found(pending.routeCount)
            this.highlightKey = stored.name
            delete this.urlError
            this.startLoading(stored.name)
            this.scheduleReturn()
        }
        catch (err) {
            this.onSaveFailed(err)
        }
        this.updatePage()
    }

    protected onSaveFailed(err: unknown) {
        this.manualState = 'error'
        if (err instanceof RouteServerValidationError && err.field === 'name') {
            this.nameError = err.message
            return
        }
        this.urlError = this.getErrorMessage(err)
    }

    /** after a successful add the confirmation is shown for a moment, then the view moves on */
    protected scheduleReturn() {
        this.clearSuccessTimer()
        const token = this.viewToken
        this.successTimer = setTimeout(() => {
            delete this.successTimer
            if (token !== this.viewToken)
                return
            if (this.origin === 'import') {
                this.close()
                return
            }
            this.view = 'list'
            this.resetManual()
            this.updatePage()
        }, SUCCESS_DELAY_MS)
    }

    protected updateSuggestion(host?: string) {
        this.suggestedName = host ? this.validSuggestion(suggestServerName(host)) : undefined
        if (!this.nameTouched)
            this.manualName = this.suggestedName ?? ''
    }

    /** a suggestion that would fail the name rules is not offered */
    protected validSuggestion(name?: string): string | undefined {
        if (!name)
            return undefined
        return this.getRouteList().validateExternalApiProviderName(name).valid ? name : undefined
    }

    protected isNameValid(): boolean {
        return this.getRouteList().validateExternalApiProviderName(this.manualName).valid
    }

    /**
     * Updates the name error. An empty name is only reported once the user has typed in the field (or asked for it)
     */
    protected validateNameLive(force = false) {
        delete this.nameError
        const res = this.getRouteList().validateExternalApiProviderName(this.manualName)
        if (res.valid)
            return
        if (res.code === 'empty' && !(this.nameTouched || force))
            return
        this.nameError = res.message
    }

    protected buildManualProps(): ManualEntryProps {
        const addressFilled = this.manualUrl.trim().length > 0
        const nameValid = this.isNameValid()
        const busy = this.manualState === 'checking' || this.manualState === 'success'

        const props: ManualEntryProps = {
            url: this.manualUrl,
            name: this.manualName,
            nameTouched: this.nameTouched,
            state: this.manualState,
            canSubmit: this.manualState === 'checked' ? nameValid : (addressFilled && nameValid && !busy),
            canCheck: addressFilled && !busy,
        }
        if (this.suggestedName)
            props.suggestedName = this.suggestedName
        if (this.resolvedUrl)
            props.resolvedUrl = this.resolvedUrl
        if (this.localNote)
            props.localNote = this.localNote
        if (this.urlError)
            props.urlError = this.urlError
        if (this.nameError)
            props.nameError = this.nameError
        if (this.message)
            props.message = this.message
        return props
    }

    // ----- protected helpers: remove -----

    protected buildRemoveDialog(key: string, routeCount: number, removeRoutes: boolean, downloadedCount?: number, downloadedSize?: string): RemoveServerDialogProps {
        const dialog: RemoveServerDialogProps = {
            key, name: key, routeCount, removeRoutes,
            title: `Remove "${key}"?`,
            confirmLabel: routeCount > 0 ? 'Remove server' : 'Remove',
        }
        if (downloadedCount)
            dialog.downloadedCount = downloadedCount
        if (downloadedSize)
            dialog.downloadedSize = downloadedSize

        if (routeCount > 0) {
            dialog.text = `You have ${MSG.routes(routeCount)} from this server in your route list.`
            dialog.keepLabel = 'Keep these routes'
            dialog.removeRoutesLabel = downloadedCount
                ? `Remove these routes too, including ${downloadedCount} downloaded ${downloadedCount === 1 ? 'video' : 'videos'}${downloadedSize ? ` (${downloadedSize})` : ''}.`
                : 'Remove these routes too'
        }
        return dialog
    }

    protected async loadDownloadInfo(key: string, routeCount: number): Promise<void> {
        if (routeCount === 0)
            return

        const info = await this.getRouteList().getExternalApiProviderDownloadInfo(key)
        if (this.removeKey !== key || !this.removeDialog)
            return

        const size = info.downloadedBytes === undefined ? undefined : formatSize(info.downloadedBytes)
        this.removeDialog = this.buildRemoveDialog(key, routeCount, this.removeDialog.removeRoutes, info.downloadedCount, size)
        this.updatePage()
    }

    protected async removeServer(dialog: RemoveServerDialogProps): Promise<void> {
        const list = this.getRouteList()
        this.logEvent({ message: 'remove route server', key: dialog.key, removeRoutes: dialog.removeRoutes, routeCount: dialog.routeCount })

        list.deleteExternalApiProvider(dialog.key)
        delete this.removeDialog
        delete this.removeKey
        this.knownStates.clear()
        this.updatePage()

        if (dialog.removeRoutes) {
            const res = await list.deleteExternalApiProviderRoutes(dialog.key)
            this.logEvent({ message: 'route server routes removed', key: dialog.key, deleted: res.deleted, failed: res.failed })
            this.updatePage()
        }
    }

    // ----- protected helpers: general -----

    protected startLoading(key: string) {
        this.getRouteServerStatus().setLoading(key)
        this.getRouteList().loadExternalApiProvider(key)
            .then(() => { this.updatePage() })
            .catch(err => {
                this.logError(err, 'loadServer', { key })
                this.getRouteServerStatus().clearLoading(key)
            })
    }

    protected getErrorMessage(err: unknown): string {
        if (err instanceof RouteServerValidationError)
            return err.message
        return MSG.probeUnreachable
    }

    protected resetManualResult() {
        this.manualState = 'idle'
        this.checkToken++
        delete this.urlError
        delete this.nameError
        delete this.message
        delete this.resolvedUrl
        delete this.localNote
        delete this.pending
        this.reviewRequired = false
    }

    protected resetManual() {
        this.manualUrl = ''
        this.manualName = ''
        this.nameTouched = false
        delete this.suggestedName
        this.resetManualResult()
    }

    protected resetState() {
        this.resetManual()
        this.view = 'list'
        this.origin = 'settings'
        delete this.highlightKey
        delete this.removeDialog
        delete this.removeKey
        this.knownStates.clear()
        this.knownCounts.clear()
    }

    protected clearSuccessTimer() {
        if (this.successTimer) {
            clearTimeout(this.successTimer)
            delete this.successTimer
        }
    }

    protected updatePage() {
        this.observer?.emit('page-update')
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getRouteServerStatus() {
        return useRouteServerStatus()
    }

    @Injectable
    protected getKnownServers(): Array<KnownRouteServer> {
        return getKnownRouteServers()
    }
}
