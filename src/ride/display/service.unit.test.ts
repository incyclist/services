
import { Device } from 'tcx-builder'
import { Inject } from '../../base/decorators'
import { Workout } from '../../workouts'
import {RideDisplayService} from './service'
import { Observer } from '../../base/types'
import { send } from 'node:process'

describe('CurrentRideService',()=>{

    describe('powerUp',()=>{

        let service: RideDisplayService
        let activityValues = {}
        let limits = {}
        let devicePowerUp = jest.fn()
        

        const simulateData = (s, data:Device) => {
            s.onDeviceData(data,'123')
        }

        const setupMocks = (s,props?:{workout:Workout, activityObserver:Observer})=> {
            let unselected = false
            Inject('ActivityRide',{
                getActivity: jest.fn().mockReturnValue({}),
                init: jest.fn().mockReturnValue( props?.activityObserver??new Observer()),
                getCurrentValues: jest.fn().mockReturnValue(activityValues)
            })
            Inject('WorkoutList',{
                getSelected: jest.fn().mockReturnValue( props?.workout),
                getStartSettings: jest.fn().mockReturnValue({ftp:200, useErgMode:true})
            })
            Inject('RouteList',{
                getSelected: jest.fn().mockReturnValue(null),
                getStartSettings: jest.fn().mockReturnValue({})
            })
            Inject('DeviceRide',{
                sendUpdate: jest.fn(),
                getControlAdapter: jest.fn(),
                getCyclingMode: jest.fn()
            })
            Inject('UIBinding', {
                enableScreensaver: jest.fn(),
                disableScreensaver: jest.fn(),
            })

            s.startDevices = jest.fn( ()=>{ 
                s.onStartCompleted() 
                props?.activityObserver.emit('started')
            })
            s.devicePowerUp = devicePowerUp

        }

        const cleanupMocks = (s)=> {
            s.reset()
            jest.resetAllMocks()
        }

        beforeEach( ()=>{
            Inject('UserSettings',{
                get: jest.fn().mockReturnValue(process.env.DEBUG)
            })

            service = new RideDisplayService()
        })

        afterEach( ()=>{
            if (service)
            cleanupMocks(service)
        })

        test('arrow-up after workout was stopped by user',()=>{
            const workout = new Workout({type:'workout',name:'Test Workout'})
            workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
                {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
            ] })

            const a = new Observer()
            setupMocks(service,{workout, activityObserver:a})

            service.init()
            service.start()
            service.stopWorkout()

            service.onArrowKey({key:'ArrowUp'})
            expect(devicePowerUp).toHaveBeenCalled()



        })
    })

})   