/** What the host needs to render the "workout scheduled today" prompt */
export type ScheduledWorkoutPromptDisplayProps = {
    /** Workout name */
    title: string
    /** Content id of the workout (never the composite `source:id` calendar entry id) */
    workoutId: string
}

/** Navigation intent, to be performed by the consuming app */
export type ScheduledWorkoutPromptNavigation = {
    page: 'workouts'
    autoOpenDetailsId?: string
}

export type ScheduledWorkoutPromptAnswer = 'yes' | 'no' | 'check'
