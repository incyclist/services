import { DeviceAccessService } from "./service"

export default class DeviceAccessMock extends DeviceAccessService {
    constructor() {
        super()
        DeviceAccessService._instance = this;
    }
}