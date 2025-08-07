export const parseTime = (time) => {
    const parts = time.split(':')
    const seconds = Number(parts[2])+Number(parts[1])*60+Number(parts[0])*3600
    return seconds
}

export const getFirstDayOfCurrentWeek = () => {
    const date = new Date()
    const current = date.getDay()
    const diff = date.getDate() - current + (current === 0 ? -6 : 1)

    const day = new Date(date.setDate(diff))
    return getStartOfDay(day)
}

export const getStartOfDay = ( date:Date ) => {
    const result = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    return result
}

export const addDays = ( date:Date, days:number ) => {
    const result = new Date(date.valueOf() + days*24*60*60*1000)    
    return result
    
}