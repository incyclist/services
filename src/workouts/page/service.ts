import { Singleton } from "../../base/types";
import { IncyclistPageService } from "../../base/pages";
import { Injectable } from "../../base/decorators";
import { useAppState } from "../../appstate";
import { IObserver } from "../../types";
import { FileInfo } from "../../api";
import { Observer } from "../../base/types/observer";
import { useUserSettings } from "../../settings";
import { WorkoutCard } from "../list/cards/WorkoutCard";
import { ScheduledWorkoutSettingsDisplayProps } from "../list/cards/types";
import { useWorkoutCalendar } from "../calendar";
import { WorkoutListService, useWorkoutList } from "../list/service";
import {
    GroupFilterProps,
    IWorkoutListPageService,
    ScheduledWorkoutItemProps,
    UpcomingTrainingProps,
    WorkoutDetailsProps,
    WorkoutImportDisplayProps,
    WorkoutListItemProps,
    WorkoutListPageDisplayProps
} from "./types";

const DEFAULT_IMPORT_GROUP = 'My Workouts'
const UPCOMING_COLLAPSED_COUNT = 3

@Singleton
export class WorkoutListPageService extends IncyclistPageService implements IWorkoutListPageService {

    protected groupFilter: string | null = null
    protected detailWorkoutId: string | null = null

    protected importPhase: 'landing' | 'importing' | 'result' | 'error' | undefined
    protected importingFileName: string
    protected importResult: { id: string; workoutName: string; group: string }
    protected importError: string

    protected listObserver: IObserver
    protected listUpdateHandler = this.emitPageUpdate.bind(this)
    protected calendarUpdateHandler = this.emitPageUpdate.bind(this)

    constructor() {
        super('WorkoutListPage')
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

    getPageDisplayProps(): WorkoutListPageDisplayProps {
        try {
            if (!this.getAppState().hasFeature('MOBILE_WORKOUTS')) {
                return { pageType: 'placeholder' }
            }

            const service = this.getWorkoutList()
            const loading = service.isStillLoading()
            const upcoming = this.getUpcomingTrainingProps()

            const allWorkouts = this.getAllWorkoutItems()
            const groups = this.getGroupFilterProps()
            const workouts = groups.selected ? allWorkouts.filter( w=>w.group===groups.selected) : allWorkouts

            const selectedId = service.getSelected()?.id ?? null
            const isEmpty = allWorkouts.length===0

            return { pageType:'list', loading, upcoming, groups, workouts, selectedId, isEmpty, detailWorkoutId: this.detailWorkoutId }
        }
        catch (err) {
            this.logError(err, 'getPageDisplayProps')
            return {} as WorkoutListPageDisplayProps
        }
    }

    getWorkoutDetailsProps(id: string): WorkoutDetailsProps | null {
        try {
            const card = this.findWorkoutCard(id)
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
                date: isScheduled ? (settingsProps as ScheduledWorkoutSettingsDisplayProps).date : undefined
            }
        }
        catch (err) {
            this.logError(err, 'getWorkoutDetailsProps')
            return null
        }
    }

    getImportDisplayProps(): WorkoutImportDisplayProps {
        try {
            const phase = this.importPhase ?? 'landing'
            const knownGroups = this.getKnownGroups()

            const props: WorkoutImportDisplayProps = { phase, knownGroups }
            if (phase==='importing')
                props.importing = { fileName: this.importingFileName }
            if (phase==='result')
                props.result = this.importResult
            if (phase==='error')
                props.error = this.importError

            return props
        }
        catch (err) {
            this.logError(err, 'getImportDisplayProps')
            return { phase:'landing', knownGroups:[] }
        }
    }

    // ---- list screen callbacks ---------------------------------------------

    onSelectGroup(group: string | null): void {
        try {
            this.groupFilter = group
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onSelectGroup')
        }
    }

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
            const card = this.findWorkoutCard(id)
            if (!card)
                return

            const settings = this.getWorkoutList().getStartSettings()
            card.select({ ...settings, noRoute: opts?.noRoute })
            this.getPageObserver()?.emit('start-ride', { id, noRoute: opts?.noRoute })
        }
        catch (err) {
            this.logError(err, 'onStart')
        }
    }

    onMarkForRoute(id: string): void {
        try {
            const card = this.findWorkoutCard(id)
            if (!card)
                return

            const settings = this.getWorkoutList().getStartSettings()
            card.select({ ...settings, noRoute: false })
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

    // ---- import dialog (§6) --------------------------------------------------

    onImportOpen(): void {
        try {
            this.importPhase = 'landing'
            delete this.importError
            delete this.importResult
            this.emitImportUpdate()
        }
        catch (err) {
            this.logError(err, 'onImportOpen')
        }
    }

    onImportFile(file: FileInfo): IObserver {
        const observer = new Observer()

        try {
            this.importPhase = 'importing'
            this.importingFileName = file?.name
            this.emitImportUpdate()

            this.getWorkoutList().import(file, { showImportCards:false })
                .then( ([card]) => {
                    const group = this.getLastUsedImportGroup()   // suggestion only, NOT applied

                    this.importPhase = 'result'
                    this.importResult = { id: card.getId(), workoutName: card.getTitle(), group }
                    observer.emit('success')
                    this.emitImportUpdate()
                })
                .catch( (err:Error) => {
                    this.importPhase = 'error'
                    this.importError = err?.message
                    observer.emit('error', err)
                    this.emitImportUpdate()
                })
        }
        catch (err) {
            this.logError(err, 'onImportFile')
        }
        return observer
    }

    onImportSetGroup(id: string, group: string): void {
        try {
            const card = this.findWorkoutCard(id)
            card?.move(group)
            this.persistLastUsedImportGroup(group)

            if (this.importResult)
                this.importResult = { ...this.importResult, group }

            this.emitImportUpdate()
        }
        catch (err) {
            this.logError(err, 'onImportSetGroup')
        }
    }

    onImportClose(): void {
        try {
            delete this.importPhase
            delete this.importingFileName
            delete this.importResult
            delete this.importError
            this.emitImportUpdate()
        }
        catch (err) {
            this.logError(err, 'onImportClose')
        }
    }

    // ---- internal assembly helpers ------------------------------------------

    protected getUpcomingTrainingProps(): UpcomingTrainingProps | null {
        const calendar = this.getWorkoutCalendar()
        const scheduled = calendar.getScheduledWorkouts()

        if (!scheduled || scheduled.length===0)
            return null

        const todayId = calendar.getScheduledToday()?.id ?? null
        const selectedWorkout = this.getWorkoutList().getSelected()

        const items: ScheduledWorkoutItemProps[] = scheduled.map( w => ({
            id: w.id,
            title: w.workout?.name,
            date: w.day,
            duration: this.formatDuration(w.workout?.duration),
            isToday: todayId!==null && w.id===todayId,
            selected: selectedWorkout?.id!==undefined && selectedWorkout.id===w.workout?.id,
            workout: w.workout
        }))

        return { items, collapsedCount: UPCOMING_COLLAPSED_COUNT, todayId }
    }

    protected getGroupFilterProps(): GroupFilterProps {
        const available = this.getKnownGroups()
        return { available, selected: this.groupFilter }
    }

    protected getKnownGroups(): string[] {
        const lists = this.getWorkoutList().getLists(false) ?? []
        return lists.filter( l=>l.getId()!=='scheduled').map( l=>l.getTitle())
    }

    protected getAllWorkoutItems(): WorkoutListItemProps[] {
        const lists = this.getWorkoutList().getLists(false) ?? []
        const items: WorkoutListItemProps[] = []

        lists.forEach( list => {
            if (list.getId()==='scheduled')
                return

            list.getCards().forEach( card => {
                if (card.getCardType()!=='Workout')
                    return

                const workoutCard = card as WorkoutCard
                const props = workoutCard.getDisplayProperties()
                items.push({
                    id: workoutCard.getId(),
                    title: props.title,
                    group: list.getTitle(),
                    duration: props.duration,
                    selected: props.selected,
                    canDelete: props.canDelete,
                    workout: props.workout
                })
            })
        })
        return items
    }

    protected findWorkoutCard(id: string): WorkoutCard | undefined {
        const lists = this.getWorkoutList().getLists(false) ?? []

        for (const list of lists) {
            const card = list.getCards().find( c=>c.getId()===id)
            if (card)
                return card as WorkoutCard
        }
        return undefined
    }

    protected getLastUsedImportGroup(): string {
        return this.getUserSettings().get('preferences.workouts.lastImportGroup', DEFAULT_IMPORT_GROUP)
    }

    protected persistLastUsedImportGroup(group: string): void {
        try {
            this.getUserSettings().set('preferences.workouts.lastImportGroup', group)
        }
        catch (err) {
            this.logError(err, 'persistLastUsedImportGroup')
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

    protected emitImportUpdate(): void {
        this.getPageObserver()?.emit('import-update')
    }

    @Injectable
    protected getWorkoutList(): WorkoutListService {
        return useWorkoutList()
    }

    @Injectable
    protected getWorkoutCalendar() {
        return useWorkoutCalendar()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getAppState() {
        return useAppState()
    }
}

export const getWorkoutListPageService = () => new WorkoutListPageService()
