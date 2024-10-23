import path from 'path'
import { getBindings } from '../../../../api'
import {PGMFFileReader} from './pgmf'
import fs from 'fs'
import { IFileSystem } from '../../../../api/fs'
import { loadFile } from '../../../../../__tests__/utils/loadFile'

describe ('PGMF Reader', ()=>{

    describe ('parse', ()=>{

        let reader:PGMFFileReader
        beforeEach( ()=> {
            reader = new PGMFFileReader
            getBindings().path = path
            getBindings().fs = fs as unknown as IFileSystem
        })
        
        test('valid',async ()=>{
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null,file) as Buffer

            const fileInfo = reader.parse( data )
            
            expect(fileInfo.fileType).toBe('pgmf')
            expect(fileInfo.generalInfo).toMatchObject({
                checksum: 4046398331,
                courseName: 'ES_Andalusia-1',
                wattSlopePulse: 1,
                timeDist: 1,
                totalTimeDist: 0,
                energyCons: 0,
                altitudeStart: expect.closeTo(58.7,1),
                brakeCategory: 0
              })
            const cntPoints = fileInfo.program
            expect(cntPoints).toHaveLength(1935)
            expect(cntPoints?.filter( p=>p.slope!==undefined)).toHaveLength(1935)

        })

        test('invalid file type',async ()=>{
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null,file) as Buffer

            expect ( ()=>reader.parse( data )).toThrow('Invalid file type')

        })


    })
})