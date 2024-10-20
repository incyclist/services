export const parseTime = (time) => {
    const parts = time.split(':')
    const seconds = Number(parts[2])+Number(parts[1])*60+Number(parts[0])*3600
    return seconds
}
