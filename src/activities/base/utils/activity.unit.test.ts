import { Activity } from './activity'
import { ActivityInfo } from '../model'
import { useRouteList } from '../../../routes'
import { Route } from '../../../routes/base/model/route'

describe('Activity', () => {

    describe('getExportFileName', () => {

        let activity: Activity

        const createMockActivity = (fileName: string): Activity => {
            const mockInfo: ActivityInfo = {
                summary: {
                    id: 'test-123',
                    title: 'Test Activity',
                    name: 'test-activity',
                    routeId: 'route-1',
                    routeHash: 'hash-1',
                    startTime: Date.now(),
                    rideTime: 3600,
                    distance: 50000,
                    totalElevation: 500,
                    startPos: 0,
                    realityFactor: 100,
                    uploadStatus: []
                },
                details: {
                    type: 'IncyclistActivity',
                    version: '5',
                    title: 'Test Activity',
                    id: 'test-123',
                    fileName,
                    user: { uuid: 'user-1', weight: 75 },
                    route: { hash: 'hash-1', name: 'Test Route' },
                    startTime: new Date().toISOString(),
                    time: 3600,
                    timeTotal: 3600,
                    timePause: 0,
                    startPos: 0,
                    distance: 50000,
                    totalElevation: 500,
                    logs: [],
                    routeType: 'GPX',
                    realityFactor: 100
                }
            }
            return new Activity(mockInfo)
        }

        beforeEach(() => {
            activity = createMockActivity('/path/to/activity.json')
        })

        test('should replace extension for regular file paths - tcx', async () => {
            activity.details.fileName = '/path/to/activity.json'
            const result = await activity['getExportFileName']('tcx')
            expect(result).toBe('/path/to/activity.tcx')
        })

        test('should replace extension for regular file paths - fit', async () => {
            activity.details.fileName = '/path/to/activity.json'
            const result = await activity['getExportFileName']('fit')
            expect(result).toBe('/path/to/activity.fit')
        })

        test('should replace extension for windows paths', async () => {
            activity.details.fileName = 'C:\\path\\to\\activity.json'
            const result = await activity['getExportFileName']('tcx')
            expect(result).toBe('C:\\path\\to\\activity.tcx')
        })

        test('should handle mmkv:// format for mobile - tcx', async () => {
            activity.details.fileName = 'mmkv:/db_activities/activity123.json'

            const mockPath = {
                join: jest.fn((a: string, b: string, c?: string) => {
                    if (c) return `${a}/${b}/${c}`
                    return `${a}/${b}`
                })
            }
            const mockBindings = {
                appInfo: { getAppDir: jest.fn().mockReturnValue('/home/user/app') },
                path: mockPath,
                fs: { ensureDir: jest.fn().mockResolvedValue(undefined) }
            }
            activity['getBindings'] = jest.fn().mockReturnValue(mockBindings)

            const result = await activity['getExportFileName']('tcx')

            expect(result).toBe('/home/user/app/activities/activity123.tcx')
            expect(mockBindings.appInfo.getAppDir).toHaveBeenCalled()
            expect(mockBindings.fs.ensureDir).toHaveBeenCalledWith('/home/user/app/activities')
        })

        test('should handle mmkv:// format for mobile - fit', async () => {
            activity.details.fileName = 'mmkv:/db_activities/my_ride_xyz.json'

            const mockPath = {
                join: jest.fn((a: string, b: string, c?: string) => {
                    if (c) return `${a}/${b}/${c}`
                    return `${a}/${b}`
                })
            }
            const mockBindings = {
                appInfo: { getAppDir: jest.fn().mockReturnValue('/data/app') },
                path: mockPath,
                fs: { ensureDir: jest.fn().mockResolvedValue(undefined) }
            }
            activity['getBindings'] = jest.fn().mockReturnValue(mockBindings)

            const result = await activity['getExportFileName']('fit')

            expect(result).toBe('/data/app/activities/my_ride_xyz.fit')
        })

        test('should extract filename correctly from mmkv path', async () => {
            activity.details.fileName = 'mmkv:/db_activities/complex_name_123.json'

            const mockPath = {
                join: jest.fn((a: string, b: string, c?: string) => {
                    if (c) return `${a}/${b}/${c}`
                    return `${a}/${b}`
                })
            }
            const mockBindings = {
                appInfo: { getAppDir: jest.fn().mockReturnValue('/app') },
                path: mockPath,
                fs: { ensureDir: jest.fn().mockResolvedValue(undefined) }
            }
            activity['getBindings'] = jest.fn().mockReturnValue(mockBindings)

            const result = await activity['getExportFileName']('tcx')

            expect(result).toBe('/app/activities/complex_name_123.tcx')
        })

    })

    describe('canStart', () => {

        let routeList: any

        const createWorkoutOnlyActivity = (): Activity => {
            const mockInfo: ActivityInfo = {
                summary: {
                    id: 'test-none-1',
                    title: 'Workout Only Ride',
                    name: 'workout-only-ride',
                    startTime: Date.now(),
                    rideTime: 1800,
                    distance: 0,
                    totalElevation: 0,
                    startPos: 0,
                    realityFactor: 100,
                    uploadStatus: []
                },
                details: {
                    type: 'IncyclistActivity',
                    version: '5',
                    title: 'Workout Only Ride',
                    id: 'test-none-1',
                    user: { uuid: 'user-1', weight: 75 },
                    // a workout-only ride has no route id - see
                    // services/src/activities/ride/service.ts ~line 1493, which builds
                    // `route = {name, hash, title}` without an `id` for routeType 'None'
                    route: { name: 'Workout', hash: '' },
                    startTime: new Date().toISOString(),
                    time: 1800,
                    timeTotal: 1800,
                    timePause: 0,
                    startPos: 0,
                    distance: 0,
                    totalElevation: 0,
                    logs: [],
                    routeType: 'None',
                    realityFactor: 100
                } as unknown as ActivityInfo['details']
            }
            return new Activity(mockInfo)
        }

        beforeEach(() => {
            routeList = useRouteList() as any
        })

        afterEach(() => {
            routeList.reset()
        })

        test('workout-only activity (routeType None) cannot be started', () => {
            const activity = createWorkoutOnlyActivity()
            expect(activity.canStart()).toBe(false)
        })

        test('workout-only activity (routeType None) cannot be started even when an unrelated, not-yet-synced route (no id) is in the route list', () => {
            // reproduces a real-world route list state: a locally imported route sits in
            // RouteListService.routes with description.id===undefined until it is synced/assigned
            // a server id. getRouteDescription()/getRoute() do an unguarded
            // `find(r => r.description.id === id)`, so looking up `undefined` (the workout-only
            // activity's missing route id) can false-positive match this unrelated entry.
            routeList.routes = [new Route({ title: 'Locally imported route' } as any)]

            const activity = createWorkoutOnlyActivity()
            expect(activity.canStart()).toBe(false)
        })

    })

})
