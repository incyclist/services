# DeviceAccess Service

// TODO

Pseudo Declaration:
```
DeviceAccessService <Singleton> extends EventEmitter
    enableInterface( ifaceName, binding):void
    disableInterface( ifaceName):void
    getInterface(ifaceName):Interface


    pause(ifaceName)
    resume(ifaceName)

    scan(): Promise<IncyclistDevieAdapters[]>
    stopScan(): Promise<void>

    connect(ifaceName):Promise<boolean>
    disconnect(ifaceName):Promise<boolean>

    Events:
       
       device (ifaceName, settings, capabilities )
       scan-started
       scan-stopped
       
       connect-error (ifaceName, error)
```