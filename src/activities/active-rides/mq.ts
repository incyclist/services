import { getBindings } from "../../api";
import { IMessageQueueBinding } from "../../api/mq";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { ActiveRideListMessageHandler } from "./types";


export class ActiveRideListMessageQueue extends IncyclistService{

    protected onTopicMessageHandler = this.onTopicMessage.bind(this)
    protected onTopicSubscribedHandler = this.onTopicSubscribed.bind(this)
    protected subscribed: Array<{ topic:string, filter?:string,handler:ActiveRideListMessageHandler, subscribed?:boolean}> = []
    protected hasMQErrors: boolean = false
    protected subscribeEnabled = false

    constructor() {
        super('ActiveRides')
    }


    onDisconnect() {
        const mq = this.getMessageQueue();
        if (!mq?.enabled())
            return
        
        this.unsubscribeAll()
    }

    onConnect() {
        const mq = this.getMessageQueue();
        if (!mq?.enabled())
            return

        this.enableSubscribe()
    }

    subscribe(topic:string, handler:ActiveRideListMessageHandler, filter?:string) {
        if (!this.subscribeEnabled)
            this.enableSubscribe()
        const existing = this.subscribed.find( s=>s.topic===topic)
        if (existing) {
            existing.handler = handler
            existing.filter = filter
            if (existing.subscribed)
                return
        }


        this.getMessageQueue().subscribe(topic)
        if (!existing)
            this.subscribed.push( {topic,filter,handler})
    }

    unsubscribe(topic:string) {
        const mq = this.getMessageQueue();
        if (!mq?.enabled())
            return
        const s = this.subscribed.find( s=>s.topic===topic)
        mq.unsubscribe(s.topic)
        this.subscribed.splice( this.subscribed.indexOf(s), 1)

    }

    unsubscribeAll() {
        const topics = this.subscribed??[]
        const mq = this.getMessageQueue();
        if (!mq?.enabled())
            return

        topics.forEach( s => {mq.unsubscribe(s.topic)})
        this.subscribed = []

        this.disableSubscribe()
    }

    sendMessage(topic, payload) {
        const mq = this.getMessageQueue();
        if (!mq?.enabled())
            return

        try {
            mq.publish(topic, payload)
            this.hasMQErrors = false
        }
        catch (err) {
            if (!this.hasMQErrors)
                this.logError(err, 'sendMessage', {topic, payload})
            this.hasMQErrors = true;
        }

    }


    protected enableSubscribe() {
        if (this.subscribeEnabled)
            return

        const mq = this.getMessageQueue();
        mq.on('mq-subscribed',this.onTopicSubscribedHandler)
        mq.on('mq-message',this.onTopicMessageHandler)
        this.subscribeEnabled = true
    }

    protected disableSubscribe() {
        if (!this.subscribeEnabled)
            return
        const mq = this.getMessageQueue();
        mq.off('mq-subscribed',this.onTopicSubscribedHandler)
        mq.off('mq-message',this.onTopicMessageHandler)
        this.subscribeEnabled = false

    }



    protected onTopicSubscribed(topic:string) {
        const existing = this.subscribed.find( s=>s.topic===topic)

        existing.subscribed = true
        this.logEvent( { message: 'Subscribed to topic', topic })
    }


    protected onTopicMessage(topic:string, message:string|Uint8Array) {

        if (!this.subscribeEnabled)
            return

        let payload:object
        let str;

        //console.log('# mq message', topic, message, typeof message)
        try {
            if (typeof message === 'string') {
                str = message
            }
            else if (message instanceof Uint8Array) {
                str = Buffer.from(message.buffer).toString()
            }
            payload = JSON.parse(str);

        }
        catch (err) {
            this.logError( err,'on mq-message',  {topic, mq_message:str})
        }

        if (!payload) 
            return

        let handled = false
        this.subscribed.filter( s=> s.subscribed).forEach( s=>{
            if ((s.filter && topic.startsWith(s.filter)) || (!s.filter)  ) {
                s.handler(topic,payload)
                handled = true
            }
    
        })

        if (!handled) {
            this.logEvent({message:'unknown topic message', topic, payload:message})            
        }
    }




    @Injectable
    protected getMessageQueue ():IMessageQueueBinding {
        return getBindings().mq
    }

    @Injectable
    protected getActiveRideLis

}