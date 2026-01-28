import { LogAdapter } from "gd-eventlog"

export type LogAdapterProps = {
    mode: 'development' | 'production'
}

export type ILogBinding = {
    createAdapter:(props:LogAdapterProps)=>LogAdapter,
    EventLogger:any
}