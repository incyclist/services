import { Singleton } from "../../../base/types";
import { Observer } from "../../../base/types/observer";
import { Card, CardList } from "../../../base/cardlist";
import { FileInfo } from "../../../api";
import { IObserver } from "../../../types";
import type { ActiveImportCard } from "../../list/cards/ActiveImportCard";
import type { WorkoutCreateCard } from "../../list/cards/WorkoutCreateCard";
import type { WP } from "../../list/types";
import type { DisplayType } from "../../../routes/list/types";
import { WorkoutListPageService } from "../base/service";
import {
    DesktopCreateInfoProps,
    DesktopWorkoutCardContent,
    DesktopWorkoutCardProps,
    DesktopWorkoutDetailsProps,
    DesktopWorkoutListDisplayProps,
    DesktopWorkoutListProps,
    DesktopUpcomingProps
} from "./types";

const STEP_CHANGE_AUDIO_KEY = 'preferences.workouts.stepChangeAudioSignal'
const CREATE_OVERLAY = 'Create Workout Info'
const SURFACE = 'workout-details'
const DISPLAY_TYPE_KEY = 'preferences.workoutListDisplayType'
const DEFAULT_DISPLAY_TYPE: DisplayType = 'tiles'
const SCHEDULED_ID = 'scheduled'

type DomainSubscription = { observer: IObserver, handler: (list: CardList<WP>) => void }

/**
 * Workout list page for desktop and web: card carousels per list, with the ride starting on the
 * desktop navigation targets.
 *
 * The UI only receives plain data and observers. All id-based actions and carousel pass-throughs
 * are resolved against the lists that were last handed out by `getPageDisplayProps()` (the
 * snapshot), as the domain rebuilds the scheduled list (and its cards) on every `getLists()` call.
 */
@Singleton
export class DesktopWorkoutListPageService extends WorkoutListPageService {

    protected listSnapshot = new Map<string, CardList<WP>>()
    protected listObservers = new Map<string, Observer>()
    protected domainSubscriptions: DomainSubscription[] = []
    protected lastHash: string | undefined
    protected createInfo: DesktopCreateInfoProps | null = null

    protected listUpdateHandler = this.onListEvent.bind(this)

    protected getRideTarget(ready: boolean): string {
        return ready ? '/rideOK' : '/pairingStart'
    }

    protected getRideNavigationState(): unknown {
        return { source: '/workouts' }
    }

    openPage(): IObserver {
        this.lastHash = undefined
        return super.openPage()
    }

    closePage(): void {
        try {
            this.teardownLists()
        }
        catch (err) {
            this.logError(err, 'closePage')
        }
        super.closePage()
    }

    /**
     * Provides the display props of the page: one entry per list (carousel), each with plain card data
     * and observers. Must be called whenever the page emits `page-update`.
     */
    getPageDisplayProps(): DesktopWorkoutListDisplayProps {
        try {
            const service = this.getWorkoutList()
            const lists = service.getLists()
            const loading = service.isStillLoading() || !lists

            if (loading)
                return this.getDisplayProps(true, [])

            const todayId = this.getScheduledTodayWorkoutId()
            this.updateSnapshot(lists)

            const scheduled = lists.find(l => l.getId() === SCHEDULED_ID)
            const upcoming = this.mapUpcoming(scheduled, todayId)
            const regular = lists.filter(l => l.getId() !== SCHEDULED_ID).map(l => this.mapList(l, todayId))
            return this.getDisplayProps(false, regular, upcoming)
        }
        catch (err) {
            this.logError(err, 'getPageDisplayProps')
            return this.getDisplayProps(true, [])
        }
    }

    getDisplayType(): DisplayType {
        try {
            const value = this.getUserSettings().get(DISPLAY_TYPE_KEY, DEFAULT_DISPLAY_TYPE)
            return this.isDisplayType(value) ? value : DEFAULT_DISPLAY_TYPE
        }
        catch (err) {
            this.logError(err, 'getDisplayType')
            return DEFAULT_DISPLAY_TYPE
        }
    }

    /** switches between list and tile layout (persisted in the user settings) */
    onDisplayTypeSelected(type: DisplayType): void {
        try {
            if (!this.isDisplayType(type))
                return

            this.getUserSettings().set(DISPLAY_TYPE_KEY, type)
            this.logEvent({ message: 'display type changed', displayType: type })
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onDisplayTypeSelected')
        }
    }

    /** alias of getPageDisplayProps(), as expected by web-ui's usePageService hook */
    getPageDisplayProperties(): DesktopWorkoutListDisplayProps {
        return this.getPageDisplayProps()
    }

    getWorkoutDetailsProps(id: string): DesktopWorkoutDetailsProps | null {
        try {
            const props = super.getWorkoutDetailsProps(id)
            if (!props)
                return null

            const scheduledTitle = this.getWorkoutList().getLists(false)?.find(l => l.getId() === 'scheduled')?.getTitle()
            const groups = props.groups?.filter(g => g !== scheduledTitle)

            return {
                ...props,
                groups,
                stepChangeAudioSignal: !!this.getUserSettings().get(STEP_CHANGE_AUDIO_KEY, true),
                canAddRoute: !props.attachedRoute
            }
        }
        catch (err) {
            this.logError(err, 'getWorkoutDetailsProps')
            return null
        }
    }

    // ---- card actions (by card id, resolved via the snapshot) ---------------

    /**
     * The user clicked the OK/primary action of a card
     *
     * @param id        id of the card
     * @param settings  files to be imported (only for the Import card)
     */
    onCardOK(id: string, settings?: FileInfo | FileInfo[]): void {
        try {
            const card = this.findSnapshotCard(id)
            if (!card) {
                this.logError(new Error(`card not found: ${id}`), 'onCardOK')
                return
            }

            switch (card.getCardType()) {
                case 'WorkoutImport':
                    this.importFiles(settings)
                    break
                case 'WorkoutCreate':
                    this.onCreateCardOK(card as unknown as WorkoutCreateCard)
                    break
                case 'Workout':
                case 'ScheduledWorkout':
                    this.onOpenDetails(id)
                    break
                default:
                    break
            }
        }
        catch (err) {
            this.logError(err, 'onCardOK')
        }
    }

    /**
     * The user closed the "how to create a workout" overlay
     *
     * @param markAsSeen  true if the overlay should not be shown again
     */
    onCreateInfoClosed(markAsSeen: boolean): void {
        try {
            if (!this.createInfo)
                return

            this.logEvent({ message: 'Overlay closed', overlay: CREATE_OVERLAY, markAsSeen })

            const card = this.findSnapshotCard('Create') as unknown as WorkoutCreateCard
            if (markAsSeen)
                card?.markAsSeen()

            this.createInfo = null
            this.emitPageUpdate()

            this.openCreateLink(card)
        }
        catch (err) {
            this.logError(err, 'onCreateInfoClosed')
        }
    }

    /**
     * Deletes a workout (from the details dialog or the card) or an (failed) import card
     *
     * @returns true if the delete was successful
     */
    async onDelete(id: string): Promise<boolean> {
        try {
            const card = this.findSnapshotCard(id)
            if (card?.getCardType() === 'ActiveWorkoutImport')
                return await this.deleteImportCard(card)

            const surface = this.detailWorkoutId === id ? 'details' : 'card'
            const success = await super.onDelete(id)
            this.logEvent({ message: 'workout deleted', workoutId: id, success, surface })
            return success
        }
        catch (err) {
            this.logError(err, 'onDelete')
            return false
        }
    }

    /** retries the import of a failed import card */
    onRetry(id: string): void {
        try {
            const card = this.findSnapshotCard(id)
            if (card?.getCardType() !== 'ActiveWorkoutImport') {
                this.logError(new Error(`import card not found: ${id}`), 'onRetry')
                return
            }
            (card as unknown as ActiveImportCard).retry()
        }
        catch (err) {
            this.logError(err, 'onRetry')
        }
    }

    // ---- details dialog -------------------------------------------------------

    /** enables/disables the audio signal on workout step changes (persisted in the user settings) */
    onSetStepChangeAudioSignal(enabled: boolean): void {
        try {
            this.getUserSettings().set(STEP_CHANGE_AUDIO_KEY, enabled)
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onSetStepChangeAudioSignal')
        }
    }

    /** Start button of the details dialog: rides with the attached route, or without a route if none is attached */
    onStartFromDetails(id: string): void {
        try {
            this.onStart(id, { noRoute: !this.getAttachedRouteProps() })
        }
        catch (err) {
            this.logError(err, 'onStartFromDetails')
        }
    }

    /** "Add Route" button of the details dialog: marks the workout for the next ride and opens the Routes page */
    onAddRoute(id: string): void {
        try {
            if (!this.findWorkoutCard(id, { includeScheduled: true })) {
                this.logError(new Error(`workout not found: ${id}`), 'onAddRoute')
                return
            }

            this.onMarkForRoute(id)
            this.logEvent({ message: 'attachment changed', action: 'attach', side: 'workout', surface: SURFACE, workoutId: id })
            this.moveTo('/routes', true, { source: '/workouts' })
        }
        catch (err) {
            this.logError(err, 'onAddRoute')
        }
    }

    onClearRouteSelection(): void {
        try {
            const routeId = this.getAttachedRouteProps()?.id
            super.onClearRouteSelection()
            this.logEvent({ message: 'attachment changed', action: 'clear', side: 'route', surface: SURFACE, routeId })
        }
        catch (err) {
            this.logError(err, 'onClearRouteSelection')
        }
    }

    // ---- pass-throughs to the domain (logic stays in WorkoutListService) ------

    getScreenProps() {
        try {
            return this.getWorkoutList().getScreenProps()
        }
        catch (err) {
            this.logError(err, 'getScreenProps')
        }
    }

    setScreenProps(props): void {
        try {
            this.getWorkoutList().setScreenProps(props)
        }
        catch (err) {
            this.logError(err, 'setScreenProps')
        }
    }

    /** to be called by the UI whenever it was resized (cards will be hidden until the carousels are re-initialized) */
    onResize(): void {
        try {
            this.getWorkoutList().onResize()
        }
        catch (err) {
            this.logError(err, 'onResize')
        }
    }

    /** to be called by the UI once the carousel of a list has been rendered */
    onCarouselInitialized(listId: string, item: number, itemsInSlide: number): void {
        try {
            const list = this.listSnapshot.get(listId)
            if (!list) {
                this.logError(new Error(`list not found: ${listId}`), 'onCarouselInitialized')
                return
            }
            this.getWorkoutList().onCarouselInitialized(list, item, itemsInSlide)
        }
        catch (err) {
            this.logError(err, 'onCarouselInitialized')
        }
    }

    /** to be called by the UI once the carousel of a list has changed its slide */
    onCarouselUpdated(listId: string, item: number, itemsInSlide: number): void {
        try {
            const list = this.listSnapshot.get(listId)
            if (!list) {
                this.logError(new Error(`list not found: ${listId}`), 'onCarouselUpdated')
                return
            }
            this.getWorkoutList().onCarouselUpdated(list, item, itemsInSlide)
        }
        catch (err) {
            this.logError(err, 'onCarouselUpdated')
        }
    }

    // ---- internals --------------------------------------------------------------

    protected getDisplayProps(loading: boolean, lists: DesktopWorkoutListProps[], upcoming: DesktopUpcomingProps | null = null): DesktopWorkoutListDisplayProps {
        return {
            loading, lists, upcoming,
            displayType: this.getDisplayType(),
            detailWorkoutId: this.detailWorkoutId,
            createInfo: this.createInfo
        }
    }

    protected isDisplayType(value: unknown): value is DisplayType {
        return value === 'list' || value === 'tiles'
    }

    protected mapUpcoming(list: CardList<WP> | undefined, todayId: string | null): DesktopUpcomingProps | null {
        if (!list?.getCards()?.length)
            return null
        return { ...this.mapList(list, todayId), todayId }
    }

    protected onListEvent(lists?: CardList<WP>[], hash?: string): void {
        try {
            // 'started' and 'loading' come without data
            if (hash === undefined) {
                this.emitPageUpdate()
                return
            }
            if (!lists || hash === this.lastHash)
                return

            this.lastHash = hash
            lists.forEach(l => l.getCards()?.forEach(c => c.reset()))
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onListEvent')
        }
    }

    protected updateSnapshot(lists: CardList<WP>[]): void {
        this.listSnapshot = new Map(lists.map(l => [l.getId(), l]))

        for (const id of this.listObservers.keys()) {
            if (!this.listSnapshot.has(id))
                this.listObservers.delete(id)
        }
        lists.forEach(l => this.subscribeToList(l))
    }

    protected subscribeToList(list: CardList<WP>): void {
        const observer = list.observer
        if (!observer || this.domainSubscriptions.some(s => s.observer === observer))
            return

        const listId = list.getId()
        const handler = (updated: CardList<WP>) => this.onDomainListUpdate(listId, updated)
        observer.on('update', handler)
        this.domainSubscriptions.push({ observer, handler })
    }

    protected onDomainListUpdate(listId: string, updated: CardList<WP>): void {
        try {
            if (!updated)
                return

            this.listSnapshot.set(listId, updated)
            this.getListObserver(listId).emit('update', this.mapCards(updated, this.getScheduledTodayWorkoutId()))
        }
        catch (err) {
            this.logError(err, 'onDomainListUpdate')
        }
    }

    protected teardownLists(): void {
        this.domainSubscriptions.forEach(s => s.observer.off('update', s.handler))
        this.domainSubscriptions = []
        this.listObservers.forEach(o => o.reset())
        this.listObservers.clear()
        this.listSnapshot.clear()
        this.lastHash = undefined
        this.createInfo = null
    }

    protected getListObserver(id: string): Observer {
        let observer = this.listObservers.get(id)
        if (!observer) {
            observer = new Observer()
            this.listObservers.set(id, observer)
        }
        return observer
    }

    protected mapList(list: CardList<WP>, todayId: string | null): DesktopWorkoutListProps {
        const id = list.getId()
        return { id, title: list.getTitle(), observer: this.getListObserver(id), cards: this.mapCards(list, todayId) }
    }

    protected mapCards(list: CardList<WP>, todayId: string | null): DesktopWorkoutCardProps[] {
        return (list.getCards() ?? []).map(c => this.mapCard(c, todayId))
    }

    protected mapCard(card: Card<WP>, todayId: string | null): DesktopWorkoutCardProps {
        const id = card.getId()
        const cardType = card.getCardType()
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { observer, selected, ...rest } = card.getDisplayProperties() ?? {}

        let props: DesktopWorkoutCardContent = rest
        if (cardType === 'ActiveWorkoutImport')
            props = { ...rest, canDelete: !!rest.error }
        else if (cardType === 'ScheduledWorkout')
            props = { ...rest, isToday: id === todayId }

        return { id, cardType, props, observer }
    }

    protected findSnapshotCard(id: string): Card<WP> | undefined {
        for (const list of this.listSnapshot.values()) {
            const card = list.getCards()?.find(c => c.getId() === id)
            if (card)
                return card
        }
        return undefined
    }

    protected importFiles(files?: FileInfo | FileInfo[]): void {
        if (!files)
            return
        this.getWorkoutList().import(files, { showImportCards: true })
            .catch(err => { this.logError(err, 'onCardOK') })
    }

    protected onCreateCardOK(card: WorkoutCreateCard): void {
        const { firstTime } = card.getDisplayProperties()
        if (firstTime) {
            this.logEvent({ message: 'Overlay shown', overlay: CREATE_OVERLAY })
            this.createInfo = { markAsSeenDefault: true }
            this.emitPageUpdate()
            return
        }
        this.openCreateLink(card)
    }

    protected openCreateLink(card?: WorkoutCreateCard): void {
        const link = card?.getDisplayProperties()?.link
        if (link)
            this.getUIBinding().openBrowserWindow(link)
    }

    protected async deleteImportCard(card: Card<WP>): Promise<boolean> {
        const deleted = await card.delete().wait()
        this.emitPageUpdate()
        return !!deleted
    }
}
