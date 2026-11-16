import { Singleton } from "../../../base/types";
import { Observer } from "../../../base/types/observer";
import { Card, CardList } from "../../../base/cardlist";
import { IObserver } from "../../../types";
import type { WP } from "../../list/types";
import { WorkoutListPageService } from "../base/service";
import {
    DesktopCreateInfoProps,
    DesktopWorkoutCardContent,
    DesktopWorkoutCardProps,
    DesktopWorkoutListDisplayProps,
    DesktopWorkoutListProps
} from "./types";


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
            return this.getDisplayProps(false, lists.map(l => this.mapList(l, todayId)))
        }
        catch (err) {
            this.logError(err, 'getPageDisplayProps')
            return this.getDisplayProps(true, [])
        }
    }

    /** alias of getPageDisplayProps(), as expected by web-ui's usePageService hook */
    getPageDisplayProperties(): DesktopWorkoutListDisplayProps {
        return this.getPageDisplayProps()
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

    protected getDisplayProps(loading: boolean, lists: DesktopWorkoutListProps[]): DesktopWorkoutListDisplayProps {
        return { loading, lists, detailWorkoutId: this.detailWorkoutId, createInfo: this.createInfo }
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
}
