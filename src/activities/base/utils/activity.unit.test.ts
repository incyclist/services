import { Activity } from './activity'
import { ActivityInfo } from '../model'

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

})
