import { FormattedNumber, getUnitConversionShortcuts } from "../../i18n";
import { ActivityDetails, ActivityDetailsUI, ActivityInfo, ActivityInfoUI, ActivitySummary, ActivitySummaryUI } from "../base";

export const createUIActivityInfo = (a:ActivityInfo):ActivityInfoUI => {

    if (!a)
        return a

    const {summary,details} = a

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

    ui.distance = { value:C(summary.distance,'distance', {digits:1}), unit:U('distance')}
    if (ui.distance.value>100) ui.distance.value = Math.round(ui.distance.value)
    ui.totalElevation = { value:C(summary.totalElevation,'elevation', {digits:0}), unit:U('elevation')}
    
    return ui
}


export const createUIActivityDetails =( details:ActivityDetails): ActivityDetailsUI => {
    const ui = { ...details } as ActivityDetailsUI  // shallow clone top level
    const [C,U] = getUnitConversionShortcuts()
    const formatSpeed = (v:number):FormattedNumber=> {
        return { value:C(v,'speed', {digits:1}), unit:U('speed')}
    }

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
    ui.distance = { value: C(details.distance, 'distance', { digits: 1 }), unit: U('distance') }
    ui.totalElevation = { value: C(details.totalElevation, 'elevation', { digits: 0 }), unit: U('elevation') }

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

export const _createUIActivityDetails =( details:ActivityDetails): ActivityDetailsUI => {
    
    if (!details)
        return details

    const ui = structuredClone(details) as ActivityDetailsUI
    const [C,U] = getUnitConversionShortcuts()

    ui.distance = { value:C(details.distance,'distance', {digits:1}), unit:U('distance')}
    if (ui.distance.value>100) ui.distance.value = Math.round(ui.distance.value)
    ui.totalElevation = { value:C(details.totalElevation,'elevation', {digits:0}), unit:U('elevation')}

    const formatSpeed = (v:number):FormattedNumber=> {
        return { value:C(v,'speed', {digits:1}), unit:U('speed')}
    }

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



