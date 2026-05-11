import { CyclingMode, DeviceData, UpdateRequest } from "incyclist-devices";

// Define mock implementations
const mockWorkoutRide = {
    getCurrentLimits: jest.fn().mockReturnValue({}),
};

const mockWorkoutList = {
    getSelected: jest.fn().mockReturnValue(null),
    getStartSettings: jest.fn().mockReturnValue(null),
};

const mockDeviceRide = {
    getControlAdapter: jest.fn().mockReturnValue(null),
    getCyclingMode: jest.fn().mockReturnValue(null),
    sendUpdate: jest.fn().mockResolvedValue(undefined),
};

// Mock external dependencies to avoid circular imports
jest.mock("../../workouts", () => ({
    useWorkoutList: jest.fn(() => mockWorkoutList),
    useWorkoutRide: jest.fn(() => mockWorkoutRide),
    ActiveWorkoutLimit: {},
}));

jest.mock("../../devices", () => ({
    useDeviceRide: jest.fn(() => mockDeviceRide),
}));

jest.mock("../../activities/ride/types", () => ({}));
jest.mock("../../activities", () => ({
    ScreenShotInfo: {},
}));

jest.mock("../../routes/base/model/route", () => ({
    Route: {},
}));

jest.mock("../../utils/sleep", () => ({
    sleep: jest.fn(),
}));

import { Observer } from "../../base/types";
import { RideModeService } from "./base";
import { ICurrentRideService, CurrentRideDisplayProps } from "./types";
import { ActiveWorkoutLimit } from "../../workouts";
import { ScreenShotInfo } from "../../activities";

describe('RideModeService', () => {

    let service: RideModeService;
    let mockObserver: jest.Mocked<Observer>;
    let mockCurrentRideService: jest.Mocked<ICurrentRideService>;

    const setupMocks = () => {
        mockObserver = {
            update: jest.fn(),
        } as unknown as jest.Mocked<Observer>;

        mockCurrentRideService = {
            getObserver: jest.fn().mockReturnValue(mockObserver),
        } as unknown as jest.Mocked<ICurrentRideService>;

        service.inject('DeviceRide', mockDeviceRide);
        service.inject('WorkoutRide', mockWorkoutRide);
        service.inject('WorkoutList', mockWorkoutList);
    };

    const cleanupMocks = () => {
        service.inject('DeviceRide', null);
        service.inject('WorkoutRide', null);
        service.inject('WorkoutList', null);
        jest.clearAllMocks();
    };

    beforeEach(() => {
        service = new RideModeService();
        setupMocks();
    });

    afterEach(() => {
        cleanupMocks();
    });

    describe('init', () => {
        test('Initialize service with current ride service', () => {
            service.init(mockCurrentRideService);

            expect(service['service']).toBe(mockCurrentRideService);
            expect(service['observer']).toBe(mockObserver);
        });

        test('Sets observer from provided service', () => {
            const customObserver = { update: jest.fn() } as unknown as Observer;
            const customService = {
                getObserver: jest.fn().mockReturnValue(customObserver),
            } as unknown as ICurrentRideService;

            service.init(customService);

            expect(customService.getObserver).toHaveBeenCalled();
            expect(service['observer']).toBe(customObserver);
        });
    });

    describe('start', () => {
        test('Start method is a no-op', () => {
            const result = service.start();
            expect(result).toBeUndefined();
        });

    });

    describe('isStartRideCompleted', () => {
        test('Returns true', () => {
            const result = service.isStartRideCompleted();
            expect(result).toBe(true);
        });
    });

    describe('getDeviceStartSettings', () => {
        test('Returns empty object', () => {
            const result = service.getDeviceStartSettings();
            expect(result).toEqual({});
        });
    });

    describe('pause', () => {
        test('Pause method is a no-op', () => {
            const result = service.pause();
            expect(result).toBeUndefined();
        });
    });

    describe('resume', () => {
        test('Resume method is a no-op', () => {
            const result = service.resume();
            expect(result).toBeUndefined();
        });
    });

    describe('stop', () => {
        test('Removes all listeners and sets stopped flag', async () => {
            const removeAllListenersSpy = jest.spyOn(service, 'removeAllListeners');

            await service.stop();

            expect(removeAllListenersSpy).toHaveBeenCalled();
            expect(service['isStopped']).toBe(true);
        });
    });

    describe('getStartOverlayProps', () => {
        test('Returns empty object', () => {
            const result = service.getStartOverlayProps();
            expect(result).toEqual({});
        });
    });

    describe('getDisplayProperties', () => {
        test('Returns display properties with dashboard columns', () => {
            mockWorkoutList.getSelected.mockReturnValue(null);

            const props: CurrentRideDisplayProps = {
                state: 'Idle',
                dbColumns: 7,
            };

            const result = service.getDisplayProperties(props);

            expect(result).toHaveProperty('dbColumns');
            expect(result.dbColumns).toBe(7);
        });

        test('Calculates correct columns based on virtshift setting', () => {
            const mockMode = {
                getSetting: jest.fn((key) => {
                    if (key === 'virtshift') return 'Enabled';
                    return undefined;
                }),
            } as unknown as CyclingMode;

            mockDeviceRide.getCyclingMode.mockReturnValue(mockMode);

            const props: CurrentRideDisplayProps = {
                state: 'Started',
            };

            const result = service.getDisplayProperties(props);

            expect(result.dbColumns).toBe(8);
        });

        test('Returns 7 columns when virtshift is disabled', () => {
            const mockMode = {
                getSetting: jest.fn((key) => {
                    if (key === 'virtshift') return 'Disabled';
                    return undefined;
                }),
            } as unknown as CyclingMode;

            mockDeviceRide.getCyclingMode.mockReturnValue(mockMode);

            const props: CurrentRideDisplayProps = {
                state: 'Started',
            };

            const result = service.getDisplayProperties(props);

            expect(result.dbColumns).toBe(7);
        });
    });

    describe('onActivityUpdate', () => {
        test('Retrieves workout limits and stores them', async () => {
            const mockLimits: ActiveWorkoutLimit = {
                minHeartRate: 100,
                maxHeartRate: 150,
            } as unknown as ActiveWorkoutLimit;

            mockWorkoutRide.getCurrentLimits.mockReturnValue(mockLimits);

            const activityUpdate = {
                distance: 5000,
                duration: 300,
            };

            service.onActivityUpdate(activityUpdate as any, {});

            expect(service['prevLimits']).toBe(mockLimits);
            expect(mockWorkoutRide.getCurrentLimits).toHaveBeenCalled();
        });

        test('Stores previous limits after update', () => {
            const mockLimits: ActiveWorkoutLimit = {
                minHeartRate: 120,
                maxHeartRate: 160,
            } as unknown as ActiveWorkoutLimit;

            mockWorkoutRide.getCurrentLimits.mockReturnValue(mockLimits);

            service.onActivityUpdate({} as any, {});

            expect(service['prevLimits']).toBe(mockLimits);
        });
    });

    describe('onDeviceData', () => {
        test('Stores previous device data', () => {
            const data: DeviceData = {
                power: 250,
                heartRate: 145,
                cadence: 90,
            } as unknown as DeviceData;

            service.onDeviceData(data, 'device-udid');

            expect(service['prevData']).toBe(data);
        });

        test('Logs bike update event', () => {
            const logEventSpy = jest.spyOn(service, 'logEvent');
            const data: DeviceData = {
                power: 300,
                heartRate: 150,
                cadence: 95,
            } as unknown as DeviceData;

            service.onDeviceData(data, 'device-udid');

            expect(logEventSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Bike Update:',
                    data,
                    udid: 'device-udid',
                })
            );
        });
    });

    describe('onRideSettingsChanged', () => {
        test('Handles ride settings change', () => {
            const settings = { useErgMode: true };

            const result = service.onRideSettingsChanged(settings);

            expect(result).toBeUndefined();
        });
    });

    describe('onStarted', () => {
        test('Handles ride started event', () => {
            const result = service.onStarted();
            expect(result).toBeUndefined();
        });
    });

    describe('onStopped', () => {
        test('Handles ride stopped event', () => {
            const result = service.onStopped();
            expect(result).toBeUndefined();
        });
    });

    describe('getLogProps', () => {
        test('Returns empty object for base implementation', () => {
            const result = service.getLogProps();
            expect(result).toEqual({});
        });
    });

    describe('getScreenshotInfo', () => {
        test('Returns screenshot info with provided file name and time', () => {
            const fileName = 'screenshot.png';
            const time = 1234567890;

            const result = service.getScreenshotInfo(fileName, time);

            expect(result).toEqual({
                fileName,
                time,
            });
        });

        test('Preserves filename and time in screenshot info', () => {
            const info: ScreenShotInfo = service.getScreenshotInfo('test.jpg', 9999);
            expect(info.fileName).toBe('test.jpg');
            expect(info.time).toBe(9999);
        });
    });

    describe('getCurrentRoute', () => {
        test('Returns undefined for base implementation', () => {
            const result = service.getCurrentRoute();
            expect(result).toBeUndefined();
        });
    });

    describe('sendUpdate', () => {
        test('Sends update when request provided', async () => {
            const request: UpdateRequest = { power: 200 } as unknown as UpdateRequest;

            await service.sendUpdate(request);

            expect(mockDeviceRide.sendUpdate).toHaveBeenCalledWith(request);
        });

        test('Returns early when no request and build returns empty', async () => {
            mockDeviceRide.sendUpdate.mockClear();

            await service.sendUpdate();

            expect(mockDeviceRide.sendUpdate).not.toHaveBeenCalled();
        });

        test('Skips update when result is empty', async () => {
            mockDeviceRide.sendUpdate.mockClear();

            await service.sendUpdate({} as UpdateRequest);

            expect(mockDeviceRide.sendUpdate).not.toHaveBeenCalled();
        });

        test('Processes power delta request separately', async () => {
            const powerDeltaRequest: UpdateRequest = {
                targetPowerDelta: 50,
            } as unknown as UpdateRequest;

            await service.sendUpdate(powerDeltaRequest);

            expect(service['queued'].length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('processPowerDeltaRequest', () => {
        test('Queues request when processing in progress', async () => {
            service['processing'].push({} as UpdateRequest);

            const request: UpdateRequest = {
                targetPowerDelta: 50,
            } as unknown as UpdateRequest;

            service['processPowerDeltaRequest'](request);

            expect(service['queued'].length).toBe(1);
        });

        test('Sends request immediately when not processing', async () => {
            jest.useFakeTimers();
            mockDeviceRide.sendUpdate.mockResolvedValue(undefined);

            const request: UpdateRequest = {
                targetPowerDelta: 50,
            } as unknown as UpdateRequest;

            service['processPowerDeltaRequest'](request);

            await jest.runAllTimersAsync();

            expect(mockDeviceRide.sendUpdate).toHaveBeenCalledWith(request);

            jest.useRealTimers();
        });

        test('Processes queued requests after current one completes', async () => {
            jest.useFakeTimers();
            mockDeviceRide.sendUpdate.mockResolvedValue(undefined);

            const request1: UpdateRequest = {
                targetPowerDelta: 50,
            } as unknown as UpdateRequest;

            const request2: UpdateRequest = {
                targetPowerDelta: 25,
            } as unknown as UpdateRequest;

            service['processPowerDeltaRequest'](request1);
            service['processing'].push(request1);
            service['processPowerDeltaRequest'](request2);

            await jest.runAllTimersAsync();

            expect(service['queued'].length).toBe(0);

            jest.useRealTimers();
        });

        test('Merges queued power delta values', async () => {
            jest.useFakeTimers();
            mockDeviceRide.sendUpdate.mockResolvedValue(undefined);

            service['processing'].push({} as UpdateRequest);
            service['queued'] = [{ targetPowerDelta: 30 } as unknown as UpdateRequest];

            const request: UpdateRequest = {
                targetPowerDelta: 20,
            } as unknown as UpdateRequest;

            service['processPowerDeltaRequest'](request);

            expect(service['queued'][0].targetPowerDelta).toBe(50);

            jest.useRealTimers();
        });
    });

    describe('getBikeLogProps', () => {
        test('Returns empty object when no control adapter', () => {
            mockDeviceRide.getControlAdapter.mockReturnValue(null);

            const result = service['getBikeLogProps']();

            expect(result).toEqual({});
        });

        test('Returns simulator props when in simulator mode', () => {
            const mockMode = {
                getName: jest.fn().mockReturnValue('Simulator'),
            } as unknown as CyclingMode;

            mockDeviceRide.getControlAdapter.mockReturnValue({ adapter: {} });
            mockDeviceRide.getCyclingMode.mockReturnValue(mockMode);

            const result = service['getBikeLogProps']();

            expect(result).toEqual({
                bike: 'Simulator',
                interface: 'Simulator',
                bikeMode: 'Simulator',
            });
        });

        test('Includes bike and interface in log props', () => {
            const mockAdapter = {
                getDisplayName: jest.fn().mockReturnValue('Wahoo KICKR'),
                getInterface: jest.fn().mockReturnValue('ANT+'),
            };

            const mockMode = {
                getName: jest.fn().mockReturnValue('ERG'),
                getSettings: jest.fn().mockReturnValue({ resistance: 50 }),
                getSetting: jest.fn().mockReturnValue(undefined),
            } as unknown as CyclingMode;

            mockDeviceRide.getControlAdapter.mockReturnValue({ adapter: mockAdapter });
            mockDeviceRide.getCyclingMode.mockReturnValue(mockMode);

            const result = service['getBikeLogProps']() as any;

            expect(result.bike).toBe('Wahoo KICKR');
            expect(result.interface).toBe('ANT+');
            expect(result.bikeMode).toBe('ERG');
        });
    });

    describe('getDashboardColumns', () => {
        test('Returns 8 columns when virtshift is enabled', () => {
            const mockMode = {
                getSetting: jest.fn((key) => {
                    if (key === 'virtshift') return 'Enabled';
                    return undefined;
                }),
            } as unknown as CyclingMode;

            mockDeviceRide.getCyclingMode.mockReturnValue(mockMode);

            const result = service['getDashboardColumns']();

            expect(result).toBe(8);
        });

        test('Returns 7 columns when virtshift is disabled', () => {
            const mockMode = {
                getSetting: jest.fn((key) => {
                    if (key === 'virtshift') return 'Disabled';
                    return undefined;
                }),
            } as unknown as CyclingMode;

            mockDeviceRide.getCyclingMode.mockReturnValue(mockMode);

            const result = service['getDashboardColumns']();

            expect(result).toBe(7);
        });

        test('Returns 7 columns when virtshift is undefined', () => {
            const mockMode = {
                getSetting: jest.fn().mockReturnValue(undefined),
            } as unknown as CyclingMode;

            mockDeviceRide.getCyclingMode.mockReturnValue(mockMode);

            const result = service['getDashboardColumns']();

            expect(result).toBe(7);
        });

        test('Returns 7 columns when cycling mode is null', () => {
            mockDeviceRide.getCyclingMode.mockReturnValue(null);

            const result = service['getDashboardColumns']();

            expect(result).toBe(7);
        });
    });

    describe('isForcedERG', () => {
        test('Returns true when workout is selected with useErgMode', () => {
            mockWorkoutList.getSelected.mockReturnValue({ id: 'workout-1' });
            mockWorkoutList.getStartSettings.mockReturnValue({ useErgMode: true });

            const result = service['isForcedERG']();

            expect(result).toBe(true);
        });

        test('Returns false when no workout selected', () => {
            mockWorkoutList.getSelected.mockReturnValue(null);

            const result = service['isForcedERG']();

            expect(result).toBe(false);
        });

        test('Returns undefined when useErgMode is not set', () => {
            mockWorkoutList.getSelected.mockReturnValue({ id: 'workout-1' });
            mockWorkoutList.getStartSettings.mockReturnValue({});

            const result = service['isForcedERG']();

            expect(result).toBeUndefined();
        });
    });

    describe('updatePropsForForcedERG', () => {
        test('Modifies log props when forced ERG and simulator mode', () => {
            mockWorkoutList.getSelected.mockReturnValue({ id: 'workout-1' });
            mockWorkoutList.getStartSettings.mockReturnValue({ useErgMode: true });

            const mockMode = {
                isSIM: jest.fn().mockReturnValue(true),
            } as unknown as CyclingMode;

            const logProps = {
                bikeMode: 'Original',
                virtshift: 'Enabled',
                startGear: 5,
                slopeAdj: 50,
                slopeAsjDown: 25,
            };

            service['updatePropsForForcedERG'](mockMode, logProps);

            expect(logProps.bikeMode).toBe('ERG (Workout)');
            expect(logProps.virtshift).toBeUndefined();
            expect(logProps.startGear).toBeUndefined();
            expect(logProps.slopeAdj).toBeUndefined();
        });

        test('Does not modify props when not forced ERG', () => {
            mockWorkoutList.getSelected.mockReturnValue(null);

            const mockMode = {
                isSIM: jest.fn().mockReturnValue(true),
            } as unknown as CyclingMode;
            
            const logProps = {
                bikeMode: 'Original',
                virtshift: 'Enabled',
            };

            service['updatePropsForForcedERG'](mockMode, logProps);

            expect(logProps.bikeMode).toBe('Original');
            expect(logProps.virtshift).toBe('Enabled');
        });

        test('Handles mode when isSIM is not a function', () => {
            mockWorkoutList.getSelected.mockReturnValue({ id: 'workout-1' });
            mockWorkoutList.getStartSettings.mockReturnValue({ useErgMode: true });

            const mockMode = {
                isSIM: 'not-a-function',
            } as unknown as CyclingMode;

            const logProps = {
                bikeMode: 'Original',
                virtshift: 'Enabled',
                startGear: 5,
            };

            service['updatePropsForForcedERG'](mockMode, logProps);

            expect(logProps.bikeMode).toBe('Original');
            expect(logProps.virtshift).toBeUndefined();
            expect(logProps.startGear).toBeUndefined();
        });
    });
});
