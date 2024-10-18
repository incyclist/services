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
    console.log(fileInfo)

            // expect(fileInfo.rlvInfo?.videoFile).toBe('D:\\RLV-Training\\RLV\\ES_Andalusia-1\\ES_Andalusia-1.avi')
            // expect(fileInfo.rlvInfo?.framerate).toBe(25)
            // expect(fileInfo.mapping?.length).toBe(1066)
            // expect(fileInfo.infoBoxes?.length).toBe(0)
            // expect(fileInfo.courseInfo?.length).toBe(3)
        })

        test('invalid file type',async ()=>{
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null,file) as Buffer

            expect ( ()=>reader.parse( data )).toThrow('Invalid file type')

        })


    })
})