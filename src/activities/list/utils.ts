import { Dimension, FormattedNumber, getUnitConversionShortcuts } from "../../i18n";
import { ActivityDetails, ActivityDetailsUI, ActivityInfo, ActivityInfoUI, ActivitySummary, ActivitySummaryUI } from "../base";

type ConvertFn = ReturnType<typeof getUnitConversionShortcuts>[0]
type UnitFn = ReturnType<typeof getUnitConversionShortcuts>[1]

// Builds a FormattedNumber, but only when the converted value is an actual number.
// `C()` (UnitConverterService.convert) returns `undefined` for missing/NaN input by design -
// propagating that as `{ value: undefined, unit }` gives downstream UI code (mobile) an object
// that passes presence-only checks (`'value' in x`) while still crashing on `.value.toFixed(...)`.
// Returning `undefined` here instead lets callers omit the field entirely, matching the
// established guarded pattern in `list/service.ts`'s `getSelectedActivityDisplayProps()` and the
// `?? ''` fallback already used in `ride/service.ts`.
const formatOrUndefined = (value:number, dimension:Dimension, C:ConvertFn, U:UnitFn, digits:number): FormattedNumber|undefined => {
    const converted = C(value, dimension, {digits})
    if (converted===undefined)
        return undefined
    return { value:converted, unit:U(dimension) }
}

export const createUIActivityInfo = (a:ActivityInfo):ActivityInfoUI => {

    if (!a)
        return a

    const {summary} = a

    return {
        summary:createUIActivitySummary(summary),
        details: undefined
    }
}


export const createUIActivitySummary = (summary:ActivitySummary):ActivitySummaryUI => {
    if (!summary)
        return summary

    const ui = { ...summary} as ActivitySummaryUI
    const [C,U] = getUnitConversionShortcuts()

    ui.distance = formatOrUndefined(summary.distance,'distance', C, U, 1)
    if (ui.distance!==undefined && ui.distance.value>100) ui.distance.value = Math.round(ui.distance.value)
    ui.totalElevation = formatOrUndefined(summary.totalElevation,'elevation', C, U, 0)

    return ui
}


export const createUIActivityDetails =( details:ActivityDetails): ActivityDetailsUI => {
    if (!details)
        return details
    
    const ui = { ...details } as ActivityDetailsUI  // shallow clone top level
    const [C,U] = getUnitConversionShortcuts()

    const formatSpeed = (v:number):FormattedNumber|undefined => formatOrUndefined(v,'speed', C, U, 1)

    // clone and convert stats.speed (nested object we modify)
    if (details.stats?.speed) {
        ui.stats = {
            ...details.stats,
            speed: { ...details.stats.speed }
        }
        const fields = ['min', 'max', 'avg']
        for (const field of fields) {
            ui.stats.speed[field] = formatSpeed(ui.stats.speed[field])
        }
    }

    // clone distance and elevation (primitives replaced, not mutated)
    ui.distance = formatOrUndefined(details.distance, 'distance', C, U, 1)
    ui.totalElevation = formatOrUndefined(details.totalElevation, 'elevation', C, U, 0)

    // clone logs array with shallow-cloned entries
    ui.logs = (details.logs ?? []).map(log => {
        const { speed, distance, elevation } = log
        return {
            ...log,  // shallow clone preserves all other fields
            speed: C(speed, 'speed', { digits: 1 }),
            distance: C(distance, 'distance', { digits: 2 }),
            elevation: C(elevation, 'elevation', { digits: 0 }),
        }
    })    
    return ui
}

// No live caller found (services or mobile) as of the item #54 fix - kept in sync with
// createUIActivityDetails above rather than removed, since it's exported and may be relied on
// externally.
export const _createUIActivityDetails =( details:ActivityDetails): ActivityDetailsUI => {

    if (!details)
        return details

    const ui = structuredClone(details) as ActivityDetailsUI
    const [C,U] = getUnitConversionShortcuts()

    ui.distance = formatOrUndefined(details.distance,'distance', C, U, 1)
    if (ui.distance!==undefined && ui.distance.value>100) ui.distance.value = Math.round(ui.distance.value)
    ui.totalElevation = formatOrUndefined(details.totalElevation,'elevation', C, U, 0)

    const formatSpeed = (v:number):FormattedNumber|undefined => formatOrUndefined(v,'speed', C, U, 1)

    if (ui.stats?.speed) {
        const fields = ['min','max','avg']
        for (const field of fields) {
            ui.stats.speed[field] = formatSpeed(ui.stats.speed[field])
        }
    }

    ui.logs = []
    for (const log of details.logs??[] ) {
        const {speed,distance,elevation} = log
        const uiLog = {...log}
        uiLog.speed = C(speed,'speed', {digits:1})
        uiLog.distance = C(distance,'distance', {digits:2})
        uiLog.elevation = C(elevation,'elevation', {digits:0})
        ui.logs.push(uiLog)
    }

    return ui

}



