import {EventEmitter} from "events"

export interface IMessageQueueBinding extends EventEmitter{
    enabled(): boolean
    subscribe(topic:string)
    unsubscribe(topic:string)
    publish(topic:string, payload:object)

}