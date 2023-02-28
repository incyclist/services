# incyclist-services

This Library contains the business logic used by the React components of the [Incyclist](https://incyclist.com) Indoor Cycling App. 

Incyclist uses React to render the App Front-End for PC platforms ( Windows, Mac. Linux). It is planned that in the future, React Native will be used to render the Front-Ends for other platforms ( Android, IOS, AppleTV,...)

All Services will be accessed by the Front-End using 

```
import {XXXService} from {incyclist-devices}

```

where XXX represents the Service name

The following Services are currently implemnted in this library:

## Settings
- [UserSettings](./src/settings/user/README.MD): manages the user settings 


## Devices
- [DeviceConfiguration](./src/devices/configuration/README.MD): manages the user configuration of scanned/added/selected devices
- [DeviceAccess](./src/devices/access/README.MD): manages the basic communication to the device (setting up interfacs, scanning,... )
- [Device](./src/devices/device/README.MD): allows the Front-End to communicate with a device (reading, writing data)
