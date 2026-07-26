export * from './list'
export * from './ride'
export * from './base/model'
export * from './base/graph'
export * from './page'
// `WorkoutCalendarService`/`useWorkoutCalendar` (RC-6's `getScheduledToday()`) were never
// re-exported here, so mobile's post-pairing-prompt session (5.7) could not reach them via
// the package's public entry point at all - confirmed by `require('incyclist-services').useWorkoutCalendar`
// being `undefined` against the published 1.7.83 build. `ScheduledWorkout` is intentionally
// NOT re-starred from here: `./base/model` already exports an unrelated `ScheduledWorkout`
// (the `{week, day, workoutId}` Plan-schedule-entry shape) under the same name, and `export *`
// silently drops the second, colliding binding rather than erroring - re-exporting `./calendar`
// wholesale would keep the wrong shape resolving for that name. Consumers needing the calendar
// service's richer `ScheduledWorkout` (`{id, name, type, day, workout, ...}`, returned by
// `getScheduledToday()`) should derive it structurally, e.g.
// `ReturnType<WorkoutCalendarService['getScheduledToday']>`, until the name collision is
// resolved with an intentional rename (out of scope for this addition).
export { WorkoutCalendarService, useWorkoutCalendar } from './calendar'
export type { WorkoutCalendarEntry } from './calendar'