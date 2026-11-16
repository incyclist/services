import { IncyclistPageService } from "../../../base/pages";
import { Injectable } from "../../../base/decorators";
import { IObserver } from "../../../types";
import { useUserSettings } from "../../../settings";
import { WorkoutCard } from "../../list/cards/WorkoutCard";
import { ScheduledWorkoutSettingsDisplayProps } from "../../list/cards/types";
import { useWorkoutCalendar } from "../../calendar";
import { WorkoutListService, useWorkoutList } from "../../list/service";
import { AttachedRouteProps, WorkoutDetailsProps } from "./types";
import { useDevicePairing } from "../../../devices";
import { useRouteList } from "../../../routes";

/**
 * Everything the workout list page does the same way on every platform: list lifecycle, the
 * details dialog, start/attach/clear handling. Not decorated with `@Singleton`: only the concrete
 * platform classes are.
 */
export abstract class WorkoutListPageService extends IncyclistPageService {

    protected detailWorkoutId: string | null = null

    protected listObserver: IObserver
    protected listUpdateHandler = this.emitPageUpdate.bind(this)
    protected calendarUpdateHandler = this.emitPageUpdate.bind(this)

    constructor() {
        super('WorkoutListPage')
    }

    /** Route to navigate to when a ride is started. @param ready true when devices are paired */
    protected abstract getRideTarget(ready: boolean): string

    /** Navigation state passed along when a ride is started (none by default) */
    protected getRideNavigationState(): unknown {
        return undefined
    }

    openPage(): IObserver {
        try {
            super.openPage()

            this.logEvent({ message: 'page shown', page: 'Workouts' })

            const { observer } = this.getWorkoutList().open()
            this.listObserver = observer

            this.listObserver?.on('started', this.listUpdateHandler)
            this.listObserver?.on('loading', this.listUpdateHandler)
            this.listObserver?.on('loaded', this.listUpdateHandler)
            this.listObserver?.on('updated', this.listUpdateHandler)
            this.getWorkoutCalendar().on('updated', this.calendarUpdateHandler)

            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'openPage')
        }
        return this.getPageObserver()
    }

    closePage(): void {
        try {
            this.getWorkoutList().close()

            this.listObserver?.off('started', this.listUpdateHandler)
            this.listObserver?.off('loading', this.listUpdateHandler)
            this.listObserver?.off('loaded', this.listUpdateHandler)
            this.listObserver?.off('updated', this.listUpdateHandler)
            this.getWorkoutCalendar().off('updated', this.calendarUpdateHandler)
            delete this.listObserver

            this.logEvent({ message: 'page closed', page: 'Workouts' })
            super.closePage()
        }
        catch (err) {
            this.logError(err, 'closePage')
        }
    }

    getWorkoutDetailsProps(id: string): WorkoutDetailsProps | null {
        try {
            // includeScheduled:true - this is the read path for a row opened from either the
            // regular list or the Upcoming Training section (5.19); the latter may point at a
            // scheduled-only workout with no regular counterpart, which must still resolve.
            const card = this.findWorkoutCard(id, { includeScheduled: true })
            if (!card)
                return null

            const workout = card.getData()
            const settingsProps = card.openSettings()
            const isScheduled = card.getCardType()==='ScheduledWorkout'

            return {
                id,
                title: card.getTitle(),
                description: workout?.description,
                duration: settingsProps.duration,
                workout,
                ftp: settingsProps.settings?.ftp,
                ftpRequired: settingsProps.ftpRequired,
                useErgMode: settingsProps.settings?.useErgMode,
                canStart: settingsProps.canStart,
                canStartWorkoutOnly: settingsProps.canStartWorkoutOnly,
                groups: settingsProps.categories,
                group: settingsProps.category,
                canDelete: card.canDelete(),
                isScheduled,
                date: isScheduled ? (settingsProps as ScheduledWorkoutSettingsDisplayProps).date : undefined,
                attachedRoute: this.getAttachedRouteProps()
            }
        }
        catch (err) {
            this.logError(err, 'getWorkoutDetailsProps')
            return null
        }
    }

    /**
     * The route this workout is currently paired with, for the "Route: <name>" row on the details
     * dialog (HLD §4.2). Single source, single slot (design §2). Whether the user picked this route
     * on the Routes page or via an Activity's "ride again" is not recorded and not displayed - an
     * activity resolves to its RouteCard and *that* is what gets selected, so by the time it is
     * attached there is only a route.
     */
    protected getAttachedRouteProps(): AttachedRouteProps | null {
        try {
            const route = this.getRouteList().getSelected()
            if (!route)
                return null

            return { id: route.description?.id, title: route.title }
        }
        catch (err) {
            this.logError(err, 'getAttachedRouteProps')
            return null
        }
    }

    // ---- list screen callbacks ---------------------------------------------

    onOpenDetails(id: string): void {
        try {
            this.detailWorkoutId = id
            this.logEvent({ message: 'details opened', id })
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onOpenDetails')
        }
    }

    onCloseDetails(): void {
        try {
            this.detailWorkoutId = null
            this.logEvent({ message: 'details closed' })
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onCloseDetails')
        }
    }

    // ---- details dialog: start-settings -------------------------------------

    onSetFtp(ftp: number): void {
        try {
            const current = this.getWorkoutList().getStartSettings()
            this.getWorkoutList().setStartSettings({ ...current, ftp })
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onSetFtp')
        }
    }

    onSetErgMode(enabled: boolean): void {
        try {
            const current = this.getWorkoutList().getStartSettings()
            this.getWorkoutList().setStartSettings({ ...current, useErgMode: enabled })
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onSetErgMode')
        }
    }

    onChangeGroup(id: string, group: string): void {
        try {
            // includeScheduled defaults to false - moving a workout into a group is a management
            // operation on the user's own regular card and must never resolve to a same-id
            // ScheduledWorkoutCard (5.19).
            const card = this.findWorkoutCard(id)
            card?.move(group)
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onChangeGroup')
        }
    }

    async onDelete(id: string): Promise<boolean> {
        try {
            const observer = this.getWorkoutList().deleteWorkout(id)
            const deleted = await observer.wait()
            this.emitPageUpdate()
            return !!deleted
        }
        catch (err) {
            this.logError(err, 'onDelete')
            return false
        }
    }

    // ---- ride hand-off (§3) -------------------------------------------------

    onStart(id: string, opts: { noRoute: boolean }): void {

        try {
            // includeScheduled:true - starting straight from a scheduled-only entry (no regular
            // counterpart) must keep working (5.19); select() only marks the workout for the next
            // ride, it doesn't mutate the resolved card, so this is safe even on a collision.
            const card = this.findWorkoutCard(id, { includeScheduled: true })
            if (!card)
                return

            const service = this.getWorkoutList()
            const pairing = this.getDevicePairing()

            const settings:any = service.getStartSettings()??{} as any
            card.select({ ...settings, noRoute: opts?.noRoute })

            this.logEvent( {message:'Attempting to start a ride',id,...settings, noRoute: opts?.noRoute,readyToStart:pairing.isReadyToStart(), } )

            this.detailWorkoutId = null
            service.close()
            const next = this.getRideTarget(pairing.isReadyToStart())
            const state = this.getRideNavigationState()
            if (state===undefined)
                this.moveTo(next)
            else
                this.moveTo(next, true, state)
        }
        catch(err:any) {
            this.logError(err,'onStart')
        }
    }

    onMarkForRoute(id: string): void {
        try {
            // includeScheduled:true - same rationale as onStart() (5.19).
            const card = this.findWorkoutCard(id, { includeScheduled: true })
            if (!card)
                return

            const settings = this.getWorkoutList().getStartSettings()
            card.select({ ...settings, noRoute: false })

            // FIXES_BACKLOG #43: the combo ride is started from the Routes side (RouteCard.start()),
            // which never calls this service's own onStart() - the only other place that clears
            // detailWorkoutId. Left set, WorkoutDetailsDialog silently reopens for this workout the
            // next time the Workouts page mounts, however/whenever the ride ends. Clear it here,
            // same as onStart() does, since the user is leaving the dialog either way.
            this.detailWorkoutId = null
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onMarkForRoute')
        }
    }

    onClearSelection(): void {
        try {
            this.getWorkoutList().unselect()
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onClearSelection')
        }
    }

    /**
     * '[x]' on the "Route: <name>" row (HLD §4.2). Clears only the route side of the attachment;
     * the workout selection is untouched. Exact mirror of RoutesPageService.onClearWorkoutSelection().
     * Nothing else needs clearing - ActivityListService holds no attachment state (design §2).
     */
    onClearRouteSelection(): void {
        try {
            this.getRouteList().unselect()
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onClearRouteSelection')
        }
    }

    // ---- internal helpers ---------------------------------------------------

    /**
     * Finds a card (regular or scheduled) by workout id.
     *
     * `Workout.id` is a content hash, not scoped to a particular list - a regular, user-managed
     * `WorkoutCard` can share an id with a read-only, synced `ScheduledWorkoutCard` when their
     * content matches. `getWorkoutList().getLists(false)` always puts the scheduled list first, so
     * a naive search would resolve such a collision to the scheduled card - wrong for callers that
     * manage the user's own copy (`onChangeGroup`, `onImportSetGroup`), which must never resolve to
     * a `ScheduledWorkoutCard` (see 5.19). Regular (non-scheduled) lists are therefore always
     * searched first. `includeScheduled` (opt-in, default `false`) only controls whether the
     * scheduled list is searched at all, as a last-resort fallback for a scheduled-only workout with
     * no regular counterpart (e.g. `getWorkoutDetailsProps()`/`onStart()`/`onMarkForRoute()`, which
     * legitimately need to resolve a workout that only exists as a scheduled entry) - it never takes
     * priority over a same-id regular card.
     */
    protected findWorkoutCard(id: string, opts?: { includeScheduled?: boolean }): WorkoutCard | undefined {
        const includeScheduled = opts?.includeScheduled ?? false
        const lists = this.getWorkoutList().getLists(false) ?? []

        const regularLists = lists.filter( l=>l.getId()!=='scheduled')
        const scheduledLists = includeScheduled ? lists.filter( l=>l.getId()==='scheduled') : []
        const orderedLists = [...regularLists, ...scheduledLists]

        for (const list of orderedLists) {
            const card = list.getCards().find( c=>c.getId()===id)
            if (card)
                return card as WorkoutCard
        }
        return undefined
    }

    /** Content id of the workout scheduled for today (if any) */
    protected getScheduledTodayWorkoutId(): string | null {
        try {
            const today = this.getWorkoutCalendar().getScheduledToday()
            return today?.workout?.id ?? today?.workoutId ?? null
        }
        catch (err) {
            this.logError(err, 'getScheduledTodayWorkoutId')
            return null
        }
    }

    protected formatDuration(duration: number): string {
        if (duration===undefined || duration===null)
            return ''

        if (duration<120)
            return `${duration.toFixed(0)}s`

        if (duration%60===0)
            return `${duration/60}min`

        const secVal = duration % 60
        const minVal = (duration - secVal) / 60 % 60
        const h = Math.floor((duration - secVal - minVal*60) / 3600)

        const sec = secVal<10 ? `0${secVal}` : secVal
        const min = minVal<10 ? `0${minVal}` : minVal
        if (h>0)
            return `${h}:${min}:${sec}`
        return `${min}:${sec}`
    }

    protected emitPageUpdate(): void {
        this.getPageObserver()?.emit('page-update')
    }

    @Injectable
    protected getDevicePairing() {
        return useDevicePairing()
    }


    @Injectable
    protected getWorkoutList(): WorkoutListService {
        return useWorkoutList()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getWorkoutCalendar() {
        return useWorkoutCalendar()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }
}
