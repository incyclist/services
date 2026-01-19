import { ActiveRideRoute, ActiveRideRouteType, ActiveRideUser, ActivityDetails, ActivityRouteType, ActivityStartMessage, ActivityUpdateMessage  } from "incyclist-services"
import * as fs from 'fs/promises';
import { sleep } from "incyclist-devices/lib/utils/utils";
import { v4 as createUuid } from 'uuid';
import mqtt from 'mqtt'; 
import * as dotenv from 'dotenv';
dotenv.config();

interface Arguments  {
    activity: string
    count: number
    startDelay: number
};

let mqttClient:mqtt.MqttClient = null; // replace with actual mqtt client instance

const parseActivity = async (fileName: string): Promise<ActivityDetails> => { 
    // open the JSON file identify by fileName and return the object
    // if the file does not exist, throw an error
    try {
        const fileContent = await fs.readFile(fileName, 'utf8');
        const activity = JSON.parse(fileContent) as ActivityDetails;
        return activity;
    }
    catch (err) {
        const error = err as Error
        console.error(`Error loading activity file: ${fileName}`, error.message);
        process.exit(1);
    }
}


const routeType = (type:ActivityRouteType): ActiveRideRouteType => {
    switch (type) {
        case 'GPX':
            return 'follow route'
        case 'Video':
            return 'video'
        case 'Free-Ride':       
            return 'free ride'
        default:
            console.error(`Unknown route type: ${type}`);
    }
}

const createStartMessage = (activity: ActivityDetails, uuid:string, activityId:string, sessionId:string): ActivityStartMessage => {

    const user:ActiveRideUser   = createUser(uuid, activity)
    const ride: ActiveRideRoute = createRide(activity, activityId)

    return  {
        user,
        ride,
        sessionId,
    }
}

const publishStartMessage = (message: ActivityStartMessage, sessionId:string): void => {
    // publish the message to the active rides topic
    if (!mqttClient) {
        return;
    }

    const topic = `incyclist/activity/${sessionId}/${message.ride.routeHash}/start`;

    const payload = JSON.stringify(message);
    mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
            console.error('Error publishing message:', error);
        }
    });
    
}

const publishUpdateMessage = (sessionId:string, routeHash:string, message:ActivityUpdateMessage): void => { 
    // publish the message to the active rides topic
    if (!mqttClient) {
        return;
    }

    const topic = `incyclist/activity/${sessionId}/${routeHash}/update`;

    const payload = JSON.stringify(message);
    mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
            console.error('Error publishing message:', error);
        }
    });
}

const simulate = async (activity: ActivityDetails): Promise<void> => { 

    console.log(`Simulating activity: ${activity.name}` , activity.user);

    // create a unique uuid and sessionId for the activity, using uuid package
    const uuid = createUuid();
    const sessionId = createUuid();
    const activityId = createUuid();

    const startMessage = createStartMessage(activity, uuid, activityId, sessionId);
    publishStartMessage(startMessage,sessionId);


    let prevTime = 0;
    const update:ActivityUpdateMessage = {
        position: {
            lat: activity?.logs?.[0].lat,
            lng: activity?.logs?.[0].lng,
            elevation: 0,
            slope: 0,
        },
        rideDistance: activity.startPos,
        speed: 0,
        power: 0,
        cadence: 0,
        heartrate: 0,
        lap: 0,
    }

    // iterate over the logs and print the values
    for (const log of activity.logs) {


        // build 

        console.log(`Lat:${log.lat}, Lng:${log.lng}, Speed: ${log.speed}, Power: ${log.power}, Heartrate: ${log.heartrate}, Cadence: ${log.cadence}, Slope: ${log.slope}, Time: ${log.time}`);
        update.position.lat = log.lat;
        update.position.lng = log.lng;
        update.position.elevation = log.elevation;
        update.position.slope = log.slope;
        update.rideDistance = log.distance+activity.startPos;
        update.speed = log.speed;
        update.power = log.power;
        update.cadence = log.cadence;
        update.heartrate = log.heartrate;
       

        publishUpdateMessage(sessionId, activity.route.hash, update);


        const delay = log.time*1000 - prevTime;
        prevTime = log.time*1000;
        // if the delay is less than 0, set it to 0
        await sleep(delay);
    }
    

}

const connectMqttServer = async (): Promise<void> => {
    // connect to the mqtt server, take briker url, username and password from the environment variables
    const mqttUrl = process.env.MQ_BROKER ?? 'mqtt://localhost:1883';
    const mqttUsername = process.env.MQ_USER ?? '';
    const mqttPassword = process.env.MQ_PASSWORD ?? '';

    console.log('Connecting to MQTT server:', mqttUrl);
    console.log('MQTT username:', mqttUsername);    
    console.log('MQTT password:', mqttPassword ? '******' : 'not set');

    return new Promise((resolve, reject) => {
        
        const mqttOptions: mqtt.IClientOptions = {
            username: mqttUsername,
            password: mqttPassword,
        };
        mqttClient = mqtt.connect(mqttUrl, mqttOptions);
        mqttClient.on('connect', () => {
            console.log('Connected to MQTT server');
            resolve()
        });
        mqttClient.on('error', (error) => {
            console.error('MQTT connection error:', error);
            reject(error);
        });
        mqttClient.on('close', () => {  

            console.log('MQTT connection closed');
        });
        mqttClient.on('message', (topic, message) => {
            console.log(`Received message on topic ${topic}: ${message}`);
        });
        mqttClient.on('offline', () => {
            console.log('MQTT client is offline');
        });
        mqttClient.on('reconnect', () => {
            console.log('MQTT client is attempting to reconnect');
        });
    })
}

const main = async (props:Arguments) => {

    console.log('Activity: ',props.activity)
    console.log('Count: ',props.count)
    console.log('Start Delay: ',props.startDelay)

    const promises: Promise<void>[] = []

    const activity = await parseActivity(props.activity)

    // connect to mqtt server
    await connectMqttServer();
    


    // simulate activity at least once
    promises.push(simulate(activity));

    // if count is greater than 1, simulate activity count times
    if (props.count>1)  {
        let totalDelay = 0

        for (let i = 0; i < props.count; i++) {
            let startDelay = props.startDelay;
            // if startDelay is -1, set it to a random value between 0 and 10s for every activity
            if (props.startDelay === -1) {
                startDelay = Math.floor(Math.random() * 10000);
            }
            totalDelay += startDelay;

            setTimeout(() => {
                promises.push(simulate(activity))
            },totalDelay);
        }
    }

    await Promise.all(promises);
}

const parseArgs = ():Arguments=> {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error('Usage: node index.js <activity> [count] [startDelay]');
        process.exit(1);
    }

    console.log('Arguments:', args);    
    const activity = args[0]
    const count = Number(args?.[1]??1)
    const startDelay = Number(args?.[2]??-1)
    return {activity, count, startDelay}
}


main( parseArgs() )

function createUser(uuid: string, activity: ActivityDetails): ActiveRideUser {
    const user = {
        id: uuid,
        weight: activity.user?.weight,
        name:  process.env.NAME,
        isBot:true

    };
    return user
}

function createRide(activity: ActivityDetails, activityId: string): ActiveRideRoute {
    return {
        title: activity.route?.title??activity.name,
        activityId,
        type: routeType(activity.routeType),
        startPos: activity.startPos,
        realityFactor: activity.realityFactor,
        isLap: false,
        routeHash: activity.route?.hash,
        distance: activity.distance,
    };
}
