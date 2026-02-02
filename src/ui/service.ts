import { ConsoleAdapter, EventLogger } from "gd-eventlog";
import { getBindings, IncyclistBindings } from "../api";
import { Injectable, Singleton } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { useUserSettings } from "../settings";
import { IncyclistPlatform } from "./types";
import { v4 as generateUUID } from 'uuid';
import { SerialPortProvider } from 'incyclist-devices';
import { useDeviceAccess, useDeviceConfiguration, useDevicePairing } from "../devices";
import { useFreeRideService, useRouteList } from "../routes";
import { useWorkoutList } from "../workouts";
import { useActiveRides, useActivityList } from "../activities";
import { IMessageQueueBinding } from "../api/mq";
import { OnlineStateMonitoringService, useOnlineStatusMonitoring } from "../monitoring";

@Singleton
export class UserInterfaceServcie extends IncyclistService {

    public bindings: IncyclistBindings
    protected platform!: IncyclistPlatform
    protected version!: string
    protected isTerminating: boolean
    protected queuedMessages: Array< {topic:string, payload:object} > = []
    protected iv!: NodeJS.Timeout
    protected heartbeatIv!: NodeJS.Timeout

    constructor() {
        super('Incyclist')

        this.bindings = this.getBindings()
        this.isTerminating = false
    }

    @Injectable
    getBindings( ):IncyclistBindings {
        return getBindings()

    }

    setBindings( bindings: IncyclistBindings) {
        this.bindings = { ...this.bindings, 
            ...bindings
        }
    }

    async onAppLaunch(platform:IncyclistPlatform, version:string) {

        try {
            this.platform = platform
            this.version = version
            await this.initUserSettings()
            await this.bindings.secret.init()

            this.initUser()
            this.initLogging()
            this.logEvent( {message:'App mounted' });

            this.createUserStats()
            await this.initDeviceServices()

            // trigger data preload, so that UI pages will start faster
            this.preloadData()

            // after MQ has been initialized
            this.onSessionStart()

        }
        catch(err) {
            this.logError(err,'onAppLaunch')
        }

    }

    async onAppExit() {
        try {
            if (!this.isTerminating) {
                this.isTerminating = true
                this.logEvent({message:'onAppExit called'})

                this.stopHeartbeatWorker()
                this.sendAppExitMessage()
                await useDevicePairing().exit()
                await useDeviceAccess().disconnect()
                
                


                this.logEvent({message:'onAppExit finished'})
                return true
                
            }
            return false

        }
        catch(err) {
            this.logError(err,'onAppExit')
            return true;
        }        

    }

    protected onSessionStart() {
        try {
            
            this.startQueueWorker();
            this.startHeartbeatWorker()

            let sent = false

            const user = this.getUserSettings().getValue('user',{})
            const id = this.getUserSettings().getValue('uuid',undefined)
            const {username,weight,ftp,gender} = user
            const topic = `incyclist/session/${this.session}/start`
            const os = this.getBindings().appInfo?.getOS()?.platform
            const payload = {
                user: {name:username,weight,ftp,gender,id},
                platform: this.platform,
                os,
                version: this.version,
                started: new Date().toISOString()
            }

            
            if (this.isOnline()) {
                this.sendMessage(topic,payload)                
            }
            

            if (!sent) {
                this.queueMessage(topic,payload)

            }

        }
        catch ( err) {

        }
    }

    protected startHeartbeatWorker() {
        if (this.heartbeatIv)
            return

        // send heartbeat once a minute
        this.heartbeatIv = setInterval( this.sendHeartbeat.bind(this), 60*1000)

    }

    protected stopHeartbeatWorker() {
        if (!this.heartbeatIv)
            return

        clearInterval(this.heartbeatIv)
        delete this.heartbeatIv
    }

    protected sendHeartbeat() {
        try {
            const user = this.getUserSettings().getValue('user',{})
            const id = this.getUserSettings().getValue('uuid',undefined)
            const {username,weight,ftp,gender} = user
            const topic = `incyclist/session/${this.session}/heartbeat`
            const payload = {
                user: {name:username,weight,ftp,gender,id},
                platform: this.platform,
                os: this.getBindings().appInfo?.getOS()?.platform,
                version: this.version,
            }

            
            this.sendMessage(topic,payload)                

        }
        catch {
            /* ignore */
        }


    }

    protected sendAppExitMessage() {
        if (!this.isOnline()) {
            return;
        }

        this.logEvent({message:'sending app exit message'})

        const topic = `incyclist/session/${this.session}/app-exit`
        this.sendMessage(topic,{})                
    }

    protected startQueueWorker():void {
        if (this.iv)
            return

        this.iv = setInterval( this.resendQueue.bind(this), 1000)
    }

    protected stopQueueWorker():void {
        if (!this.iv)
            return

        clearInterval(this.iv)
        this.iv = undefined
    }

    protected resendQueue():void {
        try {
            if (!this.iv || !this.isOnline() || this.queuedMessages.length===0) {
                return
            }

            const failed: Array< {topic:string, payload:object} > = []
            while (this.queuedMessages.length>0) {
                const {topic,payload} = this.queuedMessages.pop()
                const success = this.sendMessage(topic,payload)
                if (!success) {
                    failed.push( {topic,payload})
                }
            }

            this.queuedMessages.push( ...failed)
        }
        catch (err) {

        }
    }

    protected isOnline( ) {
        return this.getOnlineStatusMonitoring().onlineStatus

    }

    protected sendMessage(topic:string, payload:object) {
        const mq = this.getMessageQueue();
        if (!mq?.enabled())
            return

        try {
            mq.publish(topic, payload)
            return true
        }
        catch  {
            return false
        }

    }

    protected queueMessage(topic:string, payload:object) { 
        this.queuedMessages.push({topic,payload})
    }

    



    protected async initUserSettings() {
        if (!this.bindings.settings) {
            throw new Error('Missing binding: settings (IUserSettingsBinding)')
        }
        const us = this.getUserSettings()
        us.setBinding(this.bindings.settings)

        
        await us.init()        
    }

    protected initUser() {
        let uuid = this.getUserSettings().get('uuid',null);
        if (uuid === null || uuid === 'undefined' || uuid === 'reset') {
            uuid = generateUUID();
            this.getUserSettings().set('uuid', uuid);
        }
    }

    protected initLogging() {

        const appInfo =  this.getBindings().appInfo
        const settings = this.getUserSettings()
        const {createAdapter} = this.getBindings().logging

        const mode = settings.getValue('mode','production');
        const adapter = createAdapter({mode})

        const LOG_BLACKLIST = [ 'user','auth','cacheDir','baseDir','pageDir','appDir']
        EventLogger.setGlobalConfig('lazyLoading',true)
        EventLogger.setKeyBlackList( LOG_BLACKLIST);
        

        if (adapter) {
            EventLogger.registerAdapter(adapter);
            if (mode==='development' && adapter===null) {
                EventLogger.registerAdapter( new ConsoleAdapter( {depth:1}))   
            }
            
        }

        this.logger = new EventLogger('Incyclist')
        this.logger.setGlobal({
            version:this.version,
            appVersion: appInfo.getAppVersion(),
            uuid:this.getUserSettings().get('uuid',undefined),
            session: this.session
        });
  
    }    

    protected get session():string {
        return this.getBindings().appInfo.session
    }

    protected get uuid():string {
        return this.getUserSettings().get('uuid',null)
    }


    async initDeviceServices() {

        try {
            const deviceConfiguration = useDeviceConfiguration()
            const deviceAccess = useDeviceAccess();

            const {serial: serialFactory,ant,ble,wifi} = this.getBindings()
            const serial = serialFactory.getSerialBinding('serial')
            const tcpip =  serialFactory.getSerialBinding('tcpip')
            SerialPortProvider.getInstance().setBinding('tcpip',serial)
            SerialPortProvider.getInstance().setBinding('serial',tcpip)

            await deviceConfiguration.init()

            deviceAccess.setDefaultInterfaceProperties({scanTimeout:30000})

            this.configureInterface('ant',ant)
            this.configureInterface('ble',ble)
            this.configureInterface('serial',serial)
            this.configureInterface('tcpip',tcpip)
            this.configureInterface('wifi',wifi)

            deviceAccess.connect();
      
        }
        catch(err) {
          this.logError(err, 'initDeviceServices')
        }
      
    }  

    async preloadData() {
        try {
            const routes = useRouteList()
            const freeRide = useFreeRideService()
            const workouts = useWorkoutList()
            const activities = useActivityList()
            const activeRides = useActiveRides()

            const promises = [
                routes.preload().wait(),
                freeRide.selectStartPosition(),
                workouts.preload().wait(),
                activities.preload().wait()
            ]

            await Promise.all(promises)
            
        }
        catch (err) {
            this.logError(err,'preloadData')
        }
    }


    configureInterface(ifName:string, binding:any) {
        const deviceAccess = useDeviceAccess();
        const deviceConfiguration = useDeviceConfiguration()
    
        if(!binding) {
            deviceAccess.disableInterface(ifName)
            return;
        }


        const settings = deviceConfiguration.getInterfaceSettings(ifName)

        if (!settings)
            return

        deviceAccess.initInterface(ifName,binding,{enabled:settings.enabled})

        const {enabled , port, protocol} = settings

        if (settings.enabled) {
            const portNo = ifName==='tcpip' ? Number(port) : undefined
            
            deviceAccess.enableInterface(ifName,binding,{protocol,port:portNo,enabled})
        }
        else 
            deviceAccess.disableInterface(ifName)
    }    

    protected createUserStats() {

        const settings = this.getUserSettings()
      
        const stats = settings.get('stats', {});

        if (stats.firstLaunch === undefined) {
            stats.firstLaunch = new Date().toISOString()
            const recovered = settings.get('recovered',undefined);
            if (recovered) {

                const created = settings.get('created',undefined);
                let recoveredStr, createdStr;
                try {
                    recoveredStr = recovered ? new Date(recovered).toISOString() : undefined
                    createdStr = created ? new Date(created).toISOString() : undefined
                } catch { }

                this.logEvent({ message: 'recovered user', recovered: recoveredStr, created: createdStr })
            }
            else {
                settings.markAsNew()
                this.onNewUser()
                this.logEvent({ message: 'new user', preferences:settings.get('preferences',undefined)})
            }
        }
        else {
            this.logEvent({ message: 'app stats', stats })
        }
        stats.prevLaunch = new Date().toISOString()
        stats.launches = (stats.launches || 0) + 1;

        
        settings.set('stats', stats);
    
    }    

    protected onNewUser() {
        // nothing to do right now
    }


    @Injectable
    protected getMessageQueue ():IMessageQueueBinding {
        return getBindings().mq
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getOnlineStatusMonitoring ():OnlineStateMonitoringService {
        return useOnlineStatusMonitoring()
    }




}

export const useIncyclist = ()=> new UserInterfaceServcie()