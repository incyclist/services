import { Inject } from '../base/decorators'
import { UserInterfaceServcie } from './service'
import { EventLogger } from 'gd-eventlog'
import { IncyclistPlatform } from './types'

jest.mock('gd-eventlog')

describe('UserInterfaceService', () => {
    let service: UserInterfaceServcie
    let mockEventLogger: any
    let mockBindings: any
    let mockSettings: any

    beforeEach(() => {
        // Create mock EventLogger instance
        mockEventLogger = {
            logEvent: jest.fn(),
            setGlobal: jest.fn()
        }

        // Mock EventLogger constructor to return our mock
        ;(EventLogger as jest.Mock).mockImplementation(() => mockEventLogger)

        // Create service instance
        service = new UserInterfaceServcie()

        // Mock bindings
        mockSettings = {
            getValue: jest.fn().mockReturnValue('production'),
            get: jest.fn().mockReturnValue('test-uuid-1234')
        }

        mockBindings = {
            appInfo: {
                getAppVersion: jest.fn().mockReturnValue('1.0.0'),
                session: 'test-session-123'
            },
            logging: {
                createAdapter: jest.fn().mockReturnValue(null)
            }
        }

        // Inject mocks (via the module-level Container the @Injectable decorator reads from -
        // service.inject() alone stores under a different key and would be a no-op here)
        Inject('Bindings', mockBindings)
        service.inject('UserSettings', mockSettings)
    })

    afterEach(() => {
        Inject('Bindings', null)
    })

    describe('initLogging', () => {
        it('should include app-channel field in globals with platform value', () => {
            const platform: IncyclistPlatform = 'desktop'
            service['platform'] = platform
            service['version'] = '1.0.0'

            service['initLogging']()

            // Verify setGlobal was called with correct globals
            expect(mockEventLogger.setGlobal).toHaveBeenCalled()
            const globalsArg = mockEventLogger.setGlobal.mock.calls[0][0]

            expect(globalsArg).toHaveProperty('app-channel', 'desktop')
            expect(globalsArg).toHaveProperty('version', '1.0.0')
            expect(globalsArg).toHaveProperty('session', 'test-session-123')
            expect(globalsArg).toHaveProperty('uuid', 'test-uuid-1234')
            expect(globalsArg).toHaveProperty('appVersion', '1.0.0')
        })

        it('should include app-channel field with mobile platform', () => {
            const platform: IncyclistPlatform = 'mobile'
            service['platform'] = platform
            service['version'] = '1.0.0'

            service['initLogging']()

            const globalsArg = mockEventLogger.setGlobal.mock.calls[0][0]
            expect(globalsArg).toHaveProperty('app-channel', 'mobile')
        })

        it('should include app-channel field with web platform', () => {
            const platform: IncyclistPlatform = 'web'
            service['platform'] = platform
            service['version'] = '1.0.0'

            service['initLogging']()

            const globalsArg = mockEventLogger.setGlobal.mock.calls[0][0]
            expect(globalsArg).toHaveProperty('app-channel', 'web')
        })
    })
})
