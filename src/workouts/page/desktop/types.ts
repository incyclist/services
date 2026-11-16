export type DesktopWorkoutListDisplayProps = {
    loading: boolean                        // workoutList.isStillLoading() || lists===null
    lists: DesktopWorkoutListProps[]        // [] while loading
    detailWorkoutId: string | null          // details dialog open for this id
    createInfo: DesktopCreateInfoProps | null   // "how to create a workout" overlay
}

// Filled in by the desktop list-rendering work; the skeleton only needs the shape to exist.
export type DesktopWorkoutListProps = {
    id: string
    title: string
}

export type DesktopCreateInfoProps = {
    markAsSeenDefault: boolean
}
