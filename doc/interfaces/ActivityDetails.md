[incyclist-services - v1.2.2](../README.md) / ActivityDetails

# Interface: ActivityDetails

## Table of contents

### Properties

- [type](ActivityDetails.md#type)
- [version](ActivityDetails.md#version)
- [title](ActivityDetails.md#title)
- [id](ActivityDetails.md#id)
- [user](ActivityDetails.md#user)
- [route](ActivityDetails.md#route)
- [startTime](ActivityDetails.md#starttime)
- [time](ActivityDetails.md#time)
- [timeTotal](ActivityDetails.md#timetotal)
- [timePause](ActivityDetails.md#timepause)
- [distance](ActivityDetails.md#distance)
- [startPos](ActivityDetails.md#startpos)
- [startpos](ActivityDetails.md#startpos-1)
- [endpos](ActivityDetails.md#endpos)
- [totalElevation](ActivityDetails.md#totalelevation)
- [logs](ActivityDetails.md#logs)
- [stats](ActivityDetails.md#stats)
- [screenshots](ActivityDetails.md#screenshots)
- [routeType](ActivityDetails.md#routetype)
- [realityFactor](ActivityDetails.md#realityfactor)
- [laps](ActivityDetails.md#laps)
- [workoutSteps](ActivityDetails.md#workoutsteps)
- [name](ActivityDetails.md#name)
- [fileName](ActivityDetails.md#filename)
- [tcxFileName](ActivityDetails.md#tcxfilename)
- [fitFileName](ActivityDetails.md#fitfilename)
- [links](ActivityDetails.md#links)

## Properties

### type

• `Optional` **type**: ``"IncyclistActivity"``

file type - always has to be "IncyclistActivity"

___

### version

• `Optional` **version**: `string`

file version - at the moment always "1"

___

### title

• **title**: `string`

name of the activity

___

### id

• **id**: `string`

unique ID of the activity

___

### user

• **user**: [`ActivityUser`](../README.md#activityuser)

user information

___

### route

• **route**: [`ActivityRoute`](../README.md#activityroute)

route information

___

### startTime

• **startTime**: `string`

Start time (UTC) of the activity

___

### time

• **time**: `number`

moving time (in secs)

___

### timeTotal

• **timeTotal**: `number`

total time (in secs)

___

### timePause

• **timePause**: `number`

pausing time (in secs)

___

### distance

• **distance**: `number`

distance [in m] ridden in this activity

___

### startPos

• **startPos**: `number`

starting position [in m] of this activity

___

### startpos

• `Optional` **startpos**: `number`

**`Deprecated`**

___

### endpos

• `Optional` **endpos**: `number`

**`Deprecated`**

___

### totalElevation

• **totalElevation**: `number`

total elevation gain of this activity

___

### logs

• **logs**: [`ActivityLogRecord`](../README.md#activitylogrecord)[]

all log records

___

### stats

• `Optional` **stats**: [`ActivityStats`](../README.md#activitystats)

Statistcs ( max,min,avg) for power, speed,cadence and hrm

___

### screenshots

• `Optional` **screenshots**: [`ScreenShotInfo`](../README.md#screenshotinfo)[]

reference to screenshots made during the ride

___

### routeType

• `Optional` **routeType**: [`ActivityRouteType`](../README.md#activityroutetype)

selected route type ( Free-Ride vs. Route)

___

### realityFactor

• **realityFactor**: `number`

selected reality factor

___

### laps

• `Optional` **laps**: [`LapSummary`](../README.md#lapsummary)[]

information about all laps taken in a loop route

___

### workoutSteps

• `Optional` **workoutSteps**: [`LapSummary`](../README.md#lapsummary)[]

information about all workout steps taken in a workout activity

___

### name

• `Optional` **name**: `string`

filename (without full path)

___

### fileName

• `Optional` **fileName**: `string`

full file name (incl. path) of the activity

___

### tcxFileName

• `Optional` **tcxFileName**: `string`

full file name (incl. path) of the TCX representation of this activity

___

### fitFileName

• `Optional` **fitFileName**: `string`

full file name (incl. path) of the FIT representation of this activity

___

### links

• `Optional` **links**: [`ActivityAppLinks`](../README.md#activityapplinks)

information about synchronizations to connected apps
