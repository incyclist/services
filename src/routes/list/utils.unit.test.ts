import { useUserSettings } from "../../settings"
import { RoutesRepoUpdates } from "./types"
import { checkIsNew, updateRepoStats } from "./utils"

describe ('Route List Utils',()=>{

    let settings
    let mockData:RoutesRepoUpdates|undefined

    beforeAll( ()=>{
        settings = useUserSettings()
        settings.get = jest.fn(()=>{
            return mockData??{}
        })
        settings.set = jest.fn()
        jest.useFakeTimers().setSystemTime(new Date('2020-01-01T17:00:00Z'));
    })

    afterAll( ()=>{
        jest.useRealTimers()
        settings.reset()
    })

    describe('updateRepoStats',()=>{


        test('no stats yet',()=>{
            mockData = undefined
            updateRepoStats()
            expect(settings.set).toHaveBeenCalledWith('repo.routesUpdates',{
                current: 1577898000000,
                initial: 1577898000000,
                })
        })
        test('has current but no initial',()=>{
            mockData = {
                current: 1500000000000
            }
            updateRepoStats()
            expect(settings.set).toHaveBeenCalledWith('repo.routesUpdates',{
                current: 1577898000000,
                initial: 1577898000000,
                prev: 1500000000000,
                })

        })
        test('normal case with intitial and current',()=>{
            mockData = {
                current: 1500002000000,
                initial: 1500000000000,
                prev: 1500001000000,
            }
            updateRepoStats()
            expect(settings.set).toHaveBeenCalledWith('repo.routesUpdates',{
                current: 1577898000000,
                initial: 1500000000000,
                prev: 1500002000000,
                })

        })

    })

    describe('checkIsNew',()=>{

        const tsDays = (n) => 1000*3600*24*n

        test('imports during initial launch should not show up as new',()=>{
            mockData = { initial:Date.now()}
            const descr = {tsImported:Date.now()}

            expect(checkIsNew(descr)).toBeFalsy()
        })
        test('local routes should not show up as new',()=>{
            mockData = { initial:Date.now()-tsDays(2), prev:Date.now()-tsDays(1), current:Date.now()}
            const descr = {isLocal:true, tsImported:Date.now()}

            expect(checkIsNew(descr)).toBeFalsy()
        })
        test('routes that were already started should not show up as new',()=>{
            mockData = { initial:Date.now()-tsDays(2), prev:Date.now()-tsDays(1), current:Date.now()}
            const descr = {tsLastStart:Date.now()-1000*3600*24*2, tsImported:Date.now()}

            expect(checkIsNew(descr)).toBeFalsy()
        })
        test('current import should show up as new',()=>{
            mockData = { initial:Date.now()-tsDays(2), prev:Date.now()-tsDays(1), current:Date.now()}
            const descr = {tsImported:Date.now()}
            
            expect(checkIsNew(descr)).toBeTruthy()
        })
        test('import older than 2 weeks should not show up as new',()=>{
            mockData = { initial:Date.now()-tsDays(200), prev:Date.now()-tsDays(1), current:Date.now()}
            const descr = {tsImported:Date.now()-tsDays(15)}
            
            expect(checkIsNew(descr)).toBeFalsy()
        })
        test('import more recent than 2 weeks should show up as new',()=>{
            mockData = { initial:Date.now()-tsDays(200), prev:Date.now()-tsDays(1), current:Date.now()}
            const descr = {tsImported:Date.now()-tsDays(13)}
            
            expect(checkIsNew(descr)).toBeTruthy()
        })

        test('current import should not show up as new',()=>{
            mockData = { initial:Date.now()-tsDays(2), prev:Date.now()-tsDays(1), current:Date.now()}
            const descr = {tsImported:Date.now()}
            
            expect(checkIsNew(descr)).toBeTruthy()
        })

    })
})