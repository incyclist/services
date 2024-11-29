import {buildSummary} from './helpers'
import fs from 'fs/promises'

describe('buildSummary',()=>{



    test('unix',async ()=>{

        const str = await fs.readFile('__tests__/data/activities/migrate.json','utf-8')
        const details = JSON.parse(str)

        const summary = buildSummary(details)
        expect(summary.title).toBe('skyrunners hausrunde')
        expect(summary.name).toBe('Incyclist Ride-20240306181607')
        

    })


    test('windows',async ()=>{

        const str = await fs.readFile('__tests__/data/activities/migrate.json','utf-8')
        const details = JSON.parse(str)

        details.fileName = 'C:\\A\\B\\C\\Incyclist Ride-20240306181607.json'

        const summary = buildSummary(details)
        expect(summary.title).toBe('skyrunners hausrunde')
        expect(summary.name).toBe('Incyclist Ride-20240306181607')
        

    })

})
