import { useAvatars } from "../../avatars";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { Observer, Singleton } from "../../base/types";
import { CoachesService, getCoachesService } from "../../coaches";
import { OnlineStateMonitoringService, useOnlineStatusMonitoring } from "../../monitoring";
import { RouteListService, useRouteList } from "../../routes";
import { UserSettingsService, useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { ActivityRouteType } from "../base";
import { IncyclistActiveRidesApi } from "../base/api/active-rides";
import { ActivityRideService, useActivityRide } from "../ride";
import { ActiveRideListMessageQueue } from "./mq";
import { ActiveRideBike, ActiveRideEntry, ActiveRideListDisplayItem, ActiveRideListMessage, ActiveRidePosition, ActiveRideRoute, ActiveRideUser, ActivityStartMessage, ActivityUpdateMessage, ActiveRideRouteType } from "./types";


/**
 * This service is used by the Front-End to get the list of active rides ("Incyclists Nearby") on a given route
 * 
 * The service implements the business logic to retrieve and update the active ride list. 
 * 
 * The active ride list is used to populate the "Incyclists Nearby" list in the UI and contains
 * the following rides:
 * - the current ride of the current user
 * - rides of other users on the same route
 * - coaches ( i.e. simulators with a given contant power or speed)
 * 
 * In offline mode, of course the list can only contain the current ride and the coaches
 * 
 * If the list only contains the current user, then the component should not be displayed in the UI
 * 
 * The ActiveRidesList Service implements an Observer pattern, were the Observer is created during start
 * It will then notify potantial consumers about relevant events:
 * 
 * - 'update'    - There was an update, which requires the UI to be updated
 * - 'completed' - The ActiveRideList was completed ( most likely the ride was completed, or a new ride was started)
 *  
 * 
 */

@Singleton
export class ActiveRidesService extends IncyclistService {
    protected session: string
    protected maxLength: number

    protected observer: Observer
    protected current: ActiveRideEntry
    protected others: ActiveRideEntry[]
    protected coaches: ActiveRideEntry[]
    protected isSubscribed: boolean
    
    protected isOnline: boolean
    protected apiState: {busy:boolean, promise?: Promise<ActiveRideEntry[]>} = {busy:false}
    protected mq: ActiveRideListMessageQueue
    protected prevLogTS:number = 0 
    protected isStarted = false

    protected readonly activityEventHandlers = {
        update: this.onActivityUpdateEvent.bind(this),
        start: this.onActivityStartEvent.bind(this),
        stop: this.onActivityStopEvent.bind(this)
    }


    protected onlineStatusHandler: ()=>void
    

    constructor() {
        super('ActiveRides')
    }

    init(session:string, maxLength:number=10):Observer {
        this.maxLength = maxLength
        
        try {
            if (this.observer) {
                this.stop()
            }

            this.session = session
            this.startOnlineCheck()
            this.start(session)
            this.observer = new Observer()
            return this.observer
        }
        catch(err) {
            this.logError(err,'init')
        }
    }

    get():ActiveRideEntry[] {

        this.updateCoaches()
        try {
            if ( !this.current || (!this.others && !this.coaches))
                return []
            if (!this.others?.length && !this.coaches?.length)
                return []

            const list: ActiveRideEntry[] = [
                this.current,
                ...this.others??[],
                ...this.coaches??[]
            ]
            return list??[]
        }
        catch(err) {
            this.logError(err,'get')
            return []
        }
    }

    getObserver() {
        return this.observer
    }

    stop() {
        if (!this.current)
            return

        try {
            
            this.logEvent({message:'group ride finished', reason:'activity stopped', activityId:this.activity?.id,routeHash:this.getRouteHash()})
            this.publishStopEvent()
            this.cleanup()    
        }
        catch(err) {
            this.logError(err,'stop')
        }
    }

    protected start(session:string) {

        if ( this.onlineStatusHandler || this.isOnline) {
            this.initList()
        }

        waitNextTick().then( ()=> {
            this.publishStartEvent()
        })

        const observer = this.getActivityRide().getObserver()
        observer.once('completed',this.stop.bind(this))
        observer.on('data', this.onActivityUpdated.bind(this))
        observer.on('paused',this.onActivityPaused.bind(this))
        observer.on('resumed',this.onActivityResumed.bind(this))

        this.subscribeActivityEvents()

    }


    protected async initList() {
        try {
            this.addCurrentActivity()

            if (!this.others && this.isOnline) {

                if (this.apiState.busy) {
                    await this.apiState.promise?.catch( ()=>{/* ignore */})
                    if (this.others)
                        return
                }

                const routeHash = this.getRouteHash()

                const promise = this.getApi().getByRouteHash(routeHash)
                this.apiState = { busy: true, promise }
                
                
                const others = await promise??[]
                this.others = this.current ? others.filter( e=> e.sessionId!==this.current.sessionId && e.user?.id!==this.current.user?.id) : others

                if (this.current && this.others?.length>0) {
                    this.isStarted = true
                    this.logEvent({message:'group ride started', active:this.others.length+1, activityId:this.activity?.id, routeHash:this.getRouteHash()})                    
                }
            }
        }
        catch(err) {
            this.logError(err,'initList')
            this.apiState = {busy:false}
        }

    }

    protected onActivityUpdated() {
        if (!this.current || !this.activity)
            return

        const logs = this.activity.logs
        if (!logs.length)
        return 
        
        const {position={},power,speed,cadence,heartrate,routeDistance,time,lap} = this.getActivityRide().getCurrentValues()
        const {lat,lng,elevation,slope} = position as ActiveRidePosition

        const payload = {
            position:{lat,lng,elevation,slope},
            rideDistance: routeDistance,
            speed, power, cadence, heartrate, lap, duration: time

        }

        this.current.currentDuration = time
        this.current.currentPosition = {lat,lng,elevation,slope}
        this.current.currentPower = power
        this.current.currentRideDistance = routeDistance
        this.current.currentSpeed = speed
        this.current.tsLastUpdate = Date.now()
        this.current.currentLap = lap

        const displayProps = this.getDisplayProps()
        this.observer.emit('update', displayProps)


        this.publishUpdateEvent(payload)
        this.logNearbyRiders(displayProps)


    }

    protected  logNearbyRiders(displayProps:ActiveRideListDisplayItem[]) {
    
        if (!this.current || !this.others?.length)
            return

        if (Date.now()-this.prevLogTS<1000)
            return

        const all = displayProps
        const logInfo = all.map(r => `${r.name}${r.isUser?'(*)':''}:${r.avatar?.shirt ?? ''}-${((r.distance??0)/1000).toFixed(1)}km-${r.lap ?? ''}-${r.power ?? '?'}W`)
            .join('|');
        
        const cnt = (this.others?.length??0) + 1
        const event = { message: 'NearbyRiders', activityId:this.activity?.id, title:this.activity?.route?.title, cnt , nearbyRiders: logInfo }               
        this.logEvent(event);
        this.prevLogTS = Date.now()
        
    }
    

    protected onActivityPaused() {
        if (!this.current)
            return

        try {
            this.current.currentSpeed = 0
            this.current.currentPower = 0
            this.current.isPaused = true
            this.current.tsLastUpdate = Date.now()

            const payload = {
                position:this.current.currentPosition,
                rideDistance: this.current.currentRideDistance,
                speed:0, power:0, cadence:0, heartrate:undefined, lap:this.current.currentLap, 
                duration: this.getActivityRide().getCurrentValues()?.time,
                isPaused:true
        
            }
            this.publishUpdateEvent(payload)
        }
        catch(err) {
            this.logError(err,'onActivityPaused')
        }
    }


    protected onActivityResumed() {
        try {
            this.current.isPaused = false
            this.current.tsLastUpdate = Date.now()

            const {position={},power,speed,cadence,heartrate,routeDistance,time,lap} = this.getActivityRide().getCurrentValues()
            const {lat,lng,elevation,slope} = position as ActiveRidePosition

            const payload = {
                position:{lat,lng,elevation,slope},
                rideDistance: routeDistance,
                speed, power, cadence, heartrate, lap, duration: time,
                isPaused:false

            }
            this.publishUpdateEvent(payload)
        }
        catch(err) {
            this.logError(err,'onActivityPaused')
        }
      
    }

    protected getDisplayProps():ActiveRideListDisplayItem[] {

        
        const items =  this.get()
        if (!items.length)
            return []
        
        const displayProps: ActiveRideListDisplayItem[] = []
        items.forEach( item=> {
            const displayItem:ActiveRideListDisplayItem = {
                isUser: item.sessionId===this.session,
                name: this.getName(item),
                diffDistance: this.getDistanceDiff(item),
                distance: item.currentRideDistance,
                avatar: this.getAvatar(item),
                lap: this.getLap(item,true),
                power: item.currentPower,
                mpower: this.getRelativePower(item),
                speed: item.currentSpeed,
            }
            displayProps.push(displayItem )
        })

        if (displayProps.length>this.maxLength) {
            const absDiff = (r) => Math.abs(r.diffDistance) 

            displayProps.sort( (a,b) => {
                return absDiff(b) > absDiff(a) ? -1 : 1
            })
            
            return displayProps.filter( (_r,idx) => idx<this.maxLength)    
           
        }

        displayProps.sort( (a,b) => {
            return b.diffDistance > a.diffDistance ? -1 : 1
        })    

        return displayProps
    }

    protected getName(item) {
        if (item.sessionId===this.session || item.user?.id===this.current.user?.id)
            return item.user?.name?.length ? item.user?.name : 'You'

        return item.user?.name?.length ? item.user?.name : this.randomName(item.user?.id)
    }

    protected randomName(id?:string) {
        const names = [ 'Alex', 'Bart', 'Cosmas', 'Dirk', 'Ernesto', 'Frank', 'Guido', 'Hans', 'Irene','John', 'Kai','Lorenzo', 'Martin', 'Naijb', 'Oswaldo', 'Pete', 'Quentin', 'Rachel', 'Sophia','Trevor', 'Ute', 'Vivian', 'Wil', 'Xaver', 'Younes', 'Zoe' ]
        
        const fnKey = id.charAt(0).toLowerCase()
        const idx = !isNaN(parseInt(fnKey)) ? parseInt(fnKey)  : fnKey.charCodeAt(0)-96

        const lnKey = id.charAt(0).toUpperCase()
        const ln = !isNaN(parseInt(lnKey)) ? ''  : lnKey

        return `${names[idx]}${ln}`

    }


    protected addCurrentActivity() {
        if (!this.activity || this.current)
            return

        this.current = {
            id:'current',
            user: this.getUser(),
            ride: this.getRideInfo(),
            bike: this.getBike(),
            sessionId: this.session,
            tsLastUpdate: Date.now(),
            currentPosition: this.getCurrentPosition()
        }
    }

    protected getAvatar( item:ActiveRideEntry) {
        const avatars = useAvatars()

        const id = item.sessionId===this.session ? 'current' : item.user?.id??item.sessionId
        const avatar =  avatars.get(id)        
        if (item.isCoach)
             avatar.type='coach'
        return avatar
        

    }

    protected getRelativePower  (r:ActiveRideEntry):number { 
        if ( r.user?.weight && r.currentPower)
            return r.currentPower / r.user.weight;
    }


    protected getLap (r:ActiveRideEntry, overwrite:boolean=false):number { 
        const isLap = this.current?.ride?.isLap;

        if (!overwrite && r.currentLap)
            return r.currentLap

        if ( isLap) {
            const route = this.current.ride;
            return  Math.floor(r.currentRideDistance / route.distance)+1;                
        }     

    }


    protected getDistance (r:ActiveRideEntry):number  {

        const lap = this.getLap(r);
        const route = this.current ? this.current.ride : r.ride;
        if (lap && route)
            return r.currentRideDistance % route.distance;
        return r.currentRideDistance || 0
    }


    protected getDistanceDiff (r:ActiveRideEntry):number  {
        if (!r) return;

        const isLap = this.current?.ride?.isLap;
        const distance = this.getDistance(r);
        const myDistance = this.getDistance(this.current);

        if (distance===undefined || myDistance===undefined)
            return;

        if ( !isLap ) 
            return myDistance - distance;
        
        const distances = [myDistance - distance, myDistance+this.current.ride.distance - distance, myDistance-this.current.ride.distance - distance];
        distances.sort( (a,b) => Math.abs(a) - Math.abs(b) );
        return distances[0];


    }



    protected getRideInfo():ActiveRideRoute {
        const route: ActiveRideRoute = {
            title: this.activity.route?.title,
            activityId: this.activity?.id,
            type: this.getType(this.activity.routeType),
            startPos: this.activity.startPos,
            realityFactor: this.activity.realityFactor,
            isLap: this.getRouteList().getSelected()?.description?.isLoop,
            routeHash: this.getRouteHash(),
            distance: this.getRouteList().getSelected()?.description?.distance
        }
        return route

    }

    protected getType(type:ActivityRouteType): ActiveRideRouteType {
        if (type==='Free-Ride') return 'free ride'
        if (type==='GPX') return 'follow route'
        if (type==='Video') return 'video'
    }

    protected get activity() {
        return this.getActivityRide().getActivity()
    }

    protected getRouteHash():string {
        if (this.activity?.routeType==='Free-Ride') {
            return ('free:'+Date.now())
        }
        return this.activity?.route?.hash
    }

    protected getUser():ActiveRideUser {
        const userFromSettings = this.getUserSettings().get('user',{})

        const user: ActiveRideUser = {
            id: this.activity.user?.uuid??userFromSettings.id,
            name: userFromSettings.username??`${userFromSettings.firstname} ${userFromSettings.lastname}`,
            weight: this.activity.user?.weight??userFromSettings.weight,
            ftp:userFromSettings.ftp,
            gender: userFromSettings.gender
    
        }
        return user
    }

    protected getBike():ActiveRideBike {
        const ar = this.getActivityRide()
        const bike:ActiveRideBike = {
            name: ar.getBike(),
            interface: ar.getBikeInterface()
        }
        return bike
    }

    protected getCurrentPosition(): ActiveRidePosition {
        
        const logs = this.activity?.logs??[]
        if ( !logs.length)
            return 

        const point = logs[logs.length-1]
        const {lat,lng,elevation,slope} = point
        return {lat,lng,elevation,slope }
    }

    protected startOnlineCheck():void {
        if (!this.onlineStatusHandler) {
            this.onlineStatusHandler = this.onOnlineStatusChange.bind(this)
            this.isOnline = this.getOnlineStatusMonitoring().onlineStatus
            if (this.isOnline)
                this.onConnect({initial:true})

            this.getOnlineStatusMonitoring().start('activeRides',this.onOnlineStatusChange )
        }
    }

    protected onOnlineStatusChange(online:boolean) {

        
        try {
            const prev = this.isOnline
            this.isOnline = online
    
            if (prev===true && online===false) {
                this.onDisconnect()
            }
            else if (prev===false && online===true) {
                this.onConnect()
            }    
        }
        catch(err) {
            this.logError(err,'onOnlineStatusChange')
        }
    }

    protected onDisconnect() {
        this.getMessageQueue().onDisconnect()
    }

    protected async onConnect(props?:{initial:boolean}) {
        const {initial=false} = props??{}

        await this.initList()

        this.getMessageQueue().onConnect()

        // reconnect after connection loss - subscribe again to activity events
        if (!initial && this.current && !this.isSubscribed)
            this.subscribeActivityEvents()
        
    }

    protected async subscribeActivityEvents() {       
        const hash = this.current?.ride.routeHash
        const topic = `incyclist/activity/+/${hash}/+`
        this.getMessageQueue().subscribe(topic,this.onActivityEvent.bind(this), 'incyclist/activity')
        this.isSubscribed = true
    }

    protected onActivityEvent(topic:string, payload:ActiveRideListMessage) {
        const keys = topic.split('/');
        const session = keys[2];

        // ignore own events
        if (session===this.current.sessionId)
            return;

        const event = keys[4];

        const handler = this.activityEventHandlers[event]
        if (handler) handler(session,payload)

    }

    protected publishStartEvent() {
        if (!this.current || !this.isOnline)
            return 

        const payload:ActivityStartMessage = {
            user: this.current.user,
            ride: this.current.ride,
            position: this.current.currentPosition,
        }
        const topic:string = `incyclist/activity/${this.session}/${this.getRouteHash()}/start`
        this.getMessageQueue().sendMessage(topic,payload)

    }
    protected onActivityStartEvent(session:string, payload:ActivityStartMessage) {

        const prevActive = this.others?.length

        try {

            // ignore activity if it already exists in our list
            const others = this.others??[]
            if (others.find( ar=>ar.sessionId===session ) )
                return



            const entry: ActiveRideEntry = {
                id: Date.now().toString(),
                tsLastUpdate:Date.now(),
                ...payload,
                sessionId:session
            }
            this.addActiveRide( entry)

            if ( prevActive===0) {
                this.isStarted = true
                this.logEvent({message:'group ride started', active:this.others.length+1, activityId:this.activity?.id, routeHash:this.getRouteHash()})
            }
            else {
                this.isStarted = true
                this.logEvent({message:'group ride user joined', active: this.others.length+1, activityId:this.activity?.id, routeHash:this.getRouteHash() } )

            }

            if (!payload.user) {
                this.getRemoteActivityDetails(session)
            }
        }
        catch(err) {
            this.logError(err,'onActivityStartEvent')
        }
    }

    protected async getRemoteActivityDetails( sessionId:string) {

        const items = await this.getApi().getBySessionId(sessionId)
        if (!items.length)
            return

        const item = items[0]
        const localItem = this.others.find( e=>e.sessionId===sessionId) 
        if (localItem) {
            localItem.user = item.user
            localItem.id = item.id
            localItem.bike = item.bike
            localItem.ride = item.ride
        }
        else {
            this.addActiveRide( item)
        }
        return item


    }

    protected publishUpdateEvent(payload) {
        if (!this.current || !this.isOnline)
            return 

        const topic:string = `incyclist/activity/${this.session}/${this.getRouteHash()}/update`
        this.getMessageQueue().sendMessage(topic,payload)
    }

    protected async onActivityUpdateEvent(session:string,payload:ActivityUpdateMessage):Promise<void> {
        try {

            // ignore events published by ourselves
            if (session===this.session )
                return
            
            const others = this.others??[]
            const existing = others.find( ar=>ar.sessionId===session ) 
            

            const prevActive = this.others?.length

            if (existing?.user) {
                existing.currentPosition = payload.position
                existing.currentDuration = payload.duration
                existing.currentPower = payload.power
                existing.currentRideDistance = payload.rideDistance
                existing.currentSpeed = payload.speed
                existing.currentLap = payload.lap
                existing.tsLastUpdate = Date.now()
            }
            else {

                const item = await this.getRemoteActivityDetails(session)
                if (!item) {
               
                    const entry: Partial<ActiveRideEntry> = {
                        id:Date.now().toString(),   
                        tsLastUpdate:Date.now(),
                        sessionId:session,
                        currentPosition: payload.position,
                        currentDuration: payload.duration,
                        currentPower: payload.power,
                        currentRideDistance: payload.rideDistance,
                        currentSpeed: payload.speed,
                        currentLap: payload.lap
        
                    }

                    this.addActiveRide(entry as ActiveRideEntry )
                }

                if ( prevActive===0) {
                    this.isStarted = true
                    this.logEvent({message:'group ride started', active:this.others.length+1, activityId:this.activity?.id, routeHash:this.getRouteHash()})
                }
                else {
                    this.isStarted = true
                    this.logEvent({message:'group ride user joined', active: this.others.length+1, activityId:this.activity?.id, routeHash:this.getRouteHash() } )
    
                }

                
            }

        }
        catch(err) {
            this.logError(err,'onActivityStartEvent')

        }


    }

    protected addActiveRide( ride:ActiveRideEntry) {
        if (!this.others)
            this.others = []
        this.others.push( ride)

    }

    protected publishStopEvent() {
        if (!this.current || !this.isOnline)
            return 
        
        const topic:string = `incyclist/activity/${this.session}/${this.getRouteHash()}/stop`
        this.getMessageQueue().sendMessage(topic,this.current)

    }

    protected onActivityStopEvent(session, payload) {
        // ignore events published by ourselves
        if (session===this.session )
            return
        
        // no remote rides known ? then we can ignore
        if (!this.others?.length)
            return
        
        const idx = this.others.findIndex( ar=> ar.sessionId===session)
        if (idx!==-1) 
            this.others.splice(idx,1)

        if (!this.isStarted)
            return

        if (this.others.length===0) {
            this.logEvent({message:'group ride finished', reason:'all riders left', activityId:this.activity?.id, routeHash:this.getRouteHash()})
        } 
        else {
            this.logEvent({message:'group ride user left', active: this.others.length+1, activityId:this.activity?.id, routeHash:this.getRouteHash() } )
        }


    }

    protected updateCoaches(){

        if (!this.current)
            return

        const coachesService = this.getCoachesService()
        const coaches = coachesService.getCoaches()

        if (!coaches?.length) {
            this.coaches = undefined
            return
        }
            

        this.coaches = coaches.map(c=>{
            const props = c.getDisplayProperties()
            const rideEntry:ActiveRideEntry = {
                id: `coach:${props.name}`,
                user: {
                    name:props.name,
                    id: `coach:${props.name}`,
                },
                ride: this.current?.ride,
                tsLastUpdate: Date.now(),
                currentRideDistance: c.getProgess(),
                currentPosition: c.getPosition(),
                isCoach:true
            }
            return rideEntry
        }) 
            

    }


    protected cleanup()  {
        delete this.current
        delete this.others
        delete this.coaches
        delete this.session
        this.isStarted = false

        this.getMessageQueue().unsubscribeAll()
        this.isSubscribed = false
        this.observer.stop()

    }

    @Injectable
    protected getOnlineStatusMonitoring ():OnlineStateMonitoringService {
        return useOnlineStatusMonitoring()
    }

    @Injectable
    protected getIncyclistActiveRidesApi():IncyclistActiveRidesApi {
        return new IncyclistActiveRidesApi()
    }

    @Injectable
    protected getUserSettings ():UserSettingsService {
        return useUserSettings()
    }
    @Injectable
    protected getActivityRide ():ActivityRideService {
        return useActivityRide()
    }
    @Injectable
    protected getRouteList ():RouteListService {
        return useRouteList()
    }

    @Injectable getCoachesService(): CoachesService {
        return getCoachesService()
    }

    protected getMessageQueue ():ActiveRideListMessageQueue {
        if (!this.mq)
            this.mq = new ActiveRideListMessageQueue() 
        return this.mq

    }

    protected getApi() {
        return this.getIncyclistActiveRidesApi()
    }

    

}

export const useActiveRides = () => { return new ActiveRidesService() }

