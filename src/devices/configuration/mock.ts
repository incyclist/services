import UserSettingsMock from "../../settings/user/mock";
import { DeviceConfigurationService } from "./service";

export default class DeviceConfigurationMock extends DeviceConfigurationService {

    constructor(settings) {
        const svc = new UserSettingsMock(settings)
        super()
        this.userSettings = svc
        DeviceConfigurationService._instance = this
    }

}