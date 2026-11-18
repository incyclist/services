/** The part of an app connection that a calendar sync provider needs to know */
export interface ICalendarSyncConnection {
    isConnected(): boolean
}
