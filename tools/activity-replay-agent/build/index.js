"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs/promises"));
const utils_1 = require("incyclist-devices/lib/utils/utils");
const uuid_1 = require("uuid");
const mqtt_1 = __importDefault(require("mqtt"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
;
let mqttClient = null;
const parseActivity = (fileName) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fileContent = yield fs.readFile(fileName, 'utf8');
        const activity = JSON.parse(fileContent);
        return activity;
    }
    catch (err) {
        const error = err;
        console.error(`Error loading activity file: ${fileName}`, error.message);
        process.exit(1);
    }
});
const routeType = (type) => {
    switch (type) {
        case 'GPX':
            return 'follow route';
        case 'Video':
            return 'video';
        case 'Free-Ride':
            return 'free ride';
        default:
            console.error(`Unknown route type: ${type}`);
    }
};
const createStartMessage = (activity, uuid, activityId, sessionId) => {
    const user = createUser(uuid, activity);
    const ride = createRide(activity, activityId);
    return {
        user,
        ride,
        sessionId,
    };
};
const publishStartMessage = (message, sessionId) => {
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
};
const publishUpdateMessage = (sessionId, routeHash, message) => {
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
};
const simulate = (activity) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`Simulating activity: ${activity.name}`);
    const uuid = (0, uuid_1.v4)();
    const sessionId = (0, uuid_1.v4)();
    const activityId = (0, uuid_1.v4)();
    const startMessage = createStartMessage(activity, uuid, activityId, sessionId);
    publishStartMessage(startMessage, sessionId);
    let prevTime = 0;
    const update = {
        position: {
            lat: activity.startPos,
            lng: activity.startPos,
            elevation: 0,
            slope: 0,
        },
        rideDistance: 0,
        speed: 0,
        power: 0,
        cadence: 0,
        heartrate: 0,
        lap: 0,
    };
    for (const log of activity.logs) {
        console.log(`Speed: ${log.speed}, Power: ${log.power}, Heartrate: ${log.heartrate}, Cadence: ${log.cadence}, Slope: ${log.slope}, Time: ${log.time}`);
        update.position.lat = log.lat;
        update.position.lng = log.lon;
        update.position.elevation = log.elevation;
        update.position.slope = log.slope;
        update.rideDistance = log.distance;
        update.speed = log.speed;
        update.power = log.power;
        update.cadence = log.cadence;
        update.heartrate = log.heartrate;
        publishUpdateMessage(sessionId, activity.route.hash, update);
        const delay = log.time * 1000 - prevTime;
        prevTime = log.time * 1000;
        yield (0, utils_1.sleep)(delay);
    }
});
const connectMqttServer = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const mqttUrl = (_a = process.env.MQ_BROKER) !== null && _a !== void 0 ? _a : 'mqtt://localhost:1883';
    const mqttUsername = (_b = process.env.MQ_USER) !== null && _b !== void 0 ? _b : '';
    const mqttPassword = (_c = process.env.MQ_PASSWORD) !== null && _c !== void 0 ? _c : '';
    console.log('Connecting to MQTT server:', mqttUrl);
    console.log('MQTT username:', mqttUsername);
    console.log('MQTT password:', mqttPassword ? '******' : 'not set');
    return new Promise((resolve, reject) => {
        const mqttOptions = {
            username: mqttUsername,
            password: mqttPassword,
        };
        mqttClient = mqtt_1.default.connect(mqttUrl, mqttOptions);
        mqttClient.on('connect', () => {
            console.log('Connected to MQTT server');
            resolve();
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
    });
});
const main = (props) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Activity: ', props.activity);
    console.log('Count: ', props.count);
    console.log('Start Delay: ', props.startDelay);
    const promises = [];
    const activity = yield parseActivity(props.activity);
    yield connectMqttServer();
    promises.push(simulate(activity));
    if (props.count > 1) {
        let totalDelay = 0;
        for (let i = 0; i < props.count; i++) {
            let startDelay = props.startDelay;
            if (props.startDelay === -1) {
                startDelay = Math.floor(Math.random() * 10000);
            }
            totalDelay += startDelay;
            setTimeout(() => {
                promises.push(simulate(activity));
            }, totalDelay);
        }
    }
    yield Promise.all(promises);
});
const parseArgs = () => {
    var _a, _b;
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: node index.js <activity> [count] [startDelay]');
        process.exit(1);
    }
    const activity = args[0];
    const count = Number((_a = args === null || args === void 0 ? void 0 : args[1]) !== null && _a !== void 0 ? _a : 1);
    const startDelay = Number((_b = args === null || args === void 0 ? void 0 : args[2]) !== null && _b !== void 0 ? _b : -1);
    return { activity, count, startDelay };
};
main(parseArgs());
function createUser(uuid, activity) {
    var _a;
    return {
        id: uuid,
        weight: (_a = activity.user) === null || _a === void 0 ? void 0 : _a.weight,
    };
}
function createRide(activity, activityId) {
    return {
        title: activity.name,
        activityId,
        type: routeType(activity.routeType),
        startPos: activity.startPos,
        realityFactor: activity.realityFactor,
        isLap: false,
        routeHash: activity.route.hash,
        distance: activity.distance,
    };
}
//# sourceMappingURL=index.js.map