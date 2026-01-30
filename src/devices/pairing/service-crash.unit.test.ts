import { Inject } from "../../base/decorators";
import { UserSettingsService } from "../../settings";
import { sleep } from "../../utils/sleep";
import { DeviceConfigurationService, DeviceConfigurationSettings } from "../configuration";
import { DevicePairingService  } from "./service";

const settings:DeviceConfigurationSettings = {
    devices:[],
    capabilities:[],
    interfaces: [
        { name:'ant', enabled:true },
        { name:'ble', enabled:true },
        { name:'serial', enabled:false, protocol:'Daum Classic' },
        { name:'tcpip', enabled:true },
    ],
}

class  DeviceConfigurationMock extends DeviceConfigurationService {
    //isInitialized() { return true}
    isLegacyConfiguration() { return false}
    

}

class UserSettingsMock extends UserSettingsService {
    constructor(dc:DeviceConfigurationSettings) {
        super()
        this.isInitialized = true
        this.settings= { ...dc}
    }
    async init():Promise<boolean>  { return true; }
    async save():Promise<void> { return; }

}

describe.skip( 'Loop on Stop',()=> {

    let service: DevicePairingService
    let settingsMock: UserSettingsMock
    let configMock: DeviceConfigurationMock
    let accessMock
    let rideMock


    beforeEach( ()=> {
        service = new DevicePairingService()
    })


    const setupMocks= ()=> {
        configMock = new DeviceConfigurationMock()
        settingsMock = new UserSettingsMock(settings)
        Inject('UserSettings',settingsMock)
        Inject('DeviceConfiguration', configMock)

    }

    const cleanupMocks = ()=> {
        Inject('UserSettings', null)
        Inject('DeviceConfiguration', null)

        service.reset()
        configMock.reset()
        jest.clearAllMocks()
    }

    test( 'serial shutdown',async ()=> {

        setupMocks()
        service.start( (newState)=>{ console.log(newState)})

        await sleep(3000)

    })




})