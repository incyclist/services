import { useAppState } from "../../appstate";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useWorkoutCalendar } from "../calendar";
import { ScheduledWorkoutPromptAnswer, ScheduledWorkoutPromptDisplayProps, ScheduledWorkoutPromptNavigation } from "./types";

// Once-per-app-session guard. Kept in the in-memory app state (not persisted), so it resets on every launch.
const SCHEDULED_PROMPT_GUARD_KEY = 'scheduledPromptShown'

/**
 * Decides whether and what to prompt when a workout is scheduled for today.
 *
 * It deliberately does not extend `IncyclistPageService`: the prompt lives inside other pages
 * and must not change the current page. Hosts hold the visible prompt in their own state and
 * perform the navigation intents returned by `onYes` / `onCheckWorkouts`.
 *
 * Events: `'scheduled'` - relay of the calendar's `'scheduled'` event; hosts call `show()` from it.
 */
@Singleton
export class ScheduledWorkoutPromptPageService extends IncyclistService {

    protected readonly relayScheduled = (...args: unknown[]) => { this.emit('scheduled', ...args) }

    constructor() {
        super('ScheduledWorkoutPrompt')
        this.getWorkoutCalendar().on('scheduled', this.relayScheduled)
    }

    /** Removes the calendar subscription (used by the singleton reset) */
    reset() {
        this.getWorkoutCalendar().off('scheduled', this.relayScheduled)
        this.removeAllListeners()
    }

    /**
     * Checks if the prompt should be shown. If so, sets the once-per-session guard
     * and returns the display props. The first caller wins, all others get `null`.
     *
     * @returns the props to show, or `null` if there is nothing to show right now
     */
    show(): ScheduledWorkoutPromptDisplayProps | null {
        try {
            const workoutId = this.findPendingWorkoutId()
            if (!workoutId) return null

            const scheduled = this.getWorkoutCalendar().getScheduledToday()
            this.getAppState().setState(SCHEDULED_PROMPT_GUARD_KEY, true)
            this.logEvent({ message: 'scheduled workout prompt shown', workoutId })
            return { title: scheduled.name, workoutId }
        }
        catch (err) {
            this.logError(err, 'show')
            return null
        }
    }

    /**
     * Pure check (no side effects) if a prompt would be shown by `show()`
     *
     * @returns true if the guard is not yet set and a workout is scheduled for today
     */
    isPending(): boolean {
        try {
            return !!this.findPendingWorkoutId()
        }
        catch (err) {
            this.logError(err, 'isPending')
            return false
        }
    }

    /**
     * User wants to start the workout
     *
     * @returns navigation intent to the workouts page, opening the details of the workout
     */
    onYes(prompt: ScheduledWorkoutPromptDisplayProps): ScheduledWorkoutPromptNavigation {
        this.logAnswer(prompt, 'yes')
        return { page: 'workouts', autoOpenDetailsId: prompt?.workoutId }
    }

    /** User dismissed the prompt */
    onNo(prompt: ScheduledWorkoutPromptDisplayProps): void {
        this.logAnswer(prompt, 'no')
    }

    /**
     * User wants to check the workouts
     *
     * @returns navigation intent to the workouts page
     */
    onCheckWorkouts(prompt: ScheduledWorkoutPromptDisplayProps): ScheduledWorkoutPromptNavigation {
        this.logAnswer(prompt, 'check')
        return { page: 'workouts' }
    }

    protected findPendingWorkoutId(): string | undefined {
        if (this.getAppState().getState(SCHEDULED_PROMPT_GUARD_KEY)) return undefined

        const scheduled = this.getWorkoutCalendar().getScheduledToday()
        if (!scheduled) return undefined

        return scheduled.workout?.id ?? scheduled.workoutId ?? undefined
    }

    protected logAnswer(prompt: ScheduledWorkoutPromptDisplayProps, answer: ScheduledWorkoutPromptAnswer) {
        this.logEvent({ message: 'scheduled workout prompt answered', workoutId: prompt?.workoutId, answer })
    }

    @Injectable
    protected getAppState() {
        return useAppState()
    }

    @Injectable
    protected getWorkoutCalendar() {
        return useWorkoutCalendar()
    }
}

/** Returns the singleton instance of the prompt page service */
export const getScheduledWorkoutPromptPageService = () => new ScheduledWorkoutPromptPageService()
