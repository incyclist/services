
import {TacxParser} from './TacxParser'
import { FileInfo, getBindings } from '../../../../api'
import path from 'path'
import fs from 'fs/promises'
import { IFileSystem } from '../../../../api/fs'
import { loadFile } from '../../../../../__tests__/utils/loadFile'

const load =  async (file) => {
    let data,error;

    try {
        data = await loadFile(null,file.filename) as ArrayBuffer           
        
    }
    catch(err) {
        error = err;
    } 
    return {data,error}

}

const mockFS:IFileSystem = fs as unknown as IFileSystem
mockFS.existsFile = async (path)=> { try { await fs.stat(path); return true} catch { return false}}
mockFS.existsDir = async (path)=> { try { await fs.stat(path); return true} catch { return false}}


describe('TacxParser',()=>{
    let parser:TacxParser
    
    beforeEach( ()=>{

        parser = new TacxParser()


        getBindings().path = path
        getBindings().fs = mockFS
        getBindings().loader = { open: load}

    })

    afterEach( ()=>{
        jest.resetAllMocks()
    })

    test('valid RLV file',async ()=>{        

        const name = 'IS_West'
        const ext = 'rlv'
        const dir = './__tests__/data/rlv'
        const file = `${dir}/${name}.${ext}`
        const fileInfo:FileInfo = {type:'file', filename:file, name:`${name}.${ext}`, ext,dir,url:undefined, delimiter:'/'}

        const {data,details} = await parser.import(fileInfo)

        expect(data.id).toBe('c99dc5e1beaec27f727c2160f8374d8d')
        expect(data.routeHash).toBe('c99dc5e1beaec27f727c2160f8374d8d')
        expect(data.distance).toBeCloseTo(109102,0)
        expect(data.elevation).toBeCloseTo(932,0)

        expect(details.title).toBe('West')
        expect(details.country).toBe('IS')
        expect(details.video?.mappings).toBeDefined()
        expect(details.video?.file).toBe(`video:///__tests__/data/rlv/${name}.avi`)    
        expect(details.video?.format).toBe('avi')
        
    })

    test('valid PGMF file',async ()=>{        

        const name = 'IS_West'
        const ext = 'pgmf'
        const dir = './__tests__/data/rlv'
        const file = `${dir}/${name}.${ext}`
        const fileInfo:FileInfo = {type:'file', filename:file, name:`${name}.${ext}`, ext,dir,url:undefined, delimiter:'/'}

        const {data,details} = await parser.import(fileInfo)

        expect(data.id).toBe('c99dc5e1beaec27f727c2160f8374d8d')
        expect(data.routeHash).toBe('c99dc5e1beaec27f727c2160f8374d8d')
        expect(data.distance).toBeCloseTo(109102,0)
        expect(data.elevation).toBeCloseTo(932,0)

        expect(details.title).toBe('West')
        expect(details.country).toBe('IS')
        expect(details.video?.mappings).toBeDefined()
        expect(details.video?.file).toBe(`video:///__tests__/data/rlv/${name}.avi`)    
        expect(details.video?.format).toBe('avi')
        
    })



    test('invalid file',async ()=>{        

        const name = 'Aigen'
        const ext = 'epp'
        const dir = './__tests__/data/rlv'
        const file = `${dir}/${name}.${ext}`
        const fileInfo:FileInfo = {type:'file', filename:file, name:`${name}.${ext}`, ext,dir,url:undefined, delimiter:'/'}

        await expect( async()=>{ await parser.import(fileInfo)}).rejects.toThrow('Unsupported file type epp')
    })



    test('existing absolute video file path in rlv',async ()=>{        

        mockFS.existsFile = jest.fn().mockResolvedValue(true)
        const name = 'ES_Andalusia-1'
        const ext = 'rlv'
        const dir = './__tests__/data/rlv'
        const file = `${dir}/${name}.${ext}`
        const fileInfo:FileInfo = {type:'file', filename:file, name:`${name}.${ext}`, ext,dir,url:undefined, delimiter:'/'}

        const {data,details} = await parser.import(fileInfo)

        expect(data.id).toBe('161c77ff9e069c1be39befe3be959a75')
        expect(data.routeHash).toBe('161c77ff9e069c1be39befe3be959a75')
        expect(data.distance).toBeCloseTo(36208,0)
        expect(data.elevation).toBeCloseTo(1185,0)

        expect(details.title).toBe('Andalusia-1')
        expect(details.country).toBe('ES')
        expect(details.video?.mappings).toBeDefined()
        expect(details.video?.file).toBe(`video:///D:\\RLV-Training\\RLV\\ES_Andalusia-1\\ES_Andalusia-1.avi`)    
        expect(details.video?.format).toBe('avi')

    })

    test('non-existing absolute video file path in rlv',async ()=>{        

        mockFS.existsFile = jest.fn().mockResolvedValue(false)
        
        const name = 'ES_Andalusia-1'
        const ext = 'rlv'
        const dir = './__tests__/data/rlv'
        const file = `${dir}/${name}.${ext}`
        const fileInfo:FileInfo = {type:'file', filename:file, name:`${name}.${ext}`, ext,dir,url:undefined, delimiter:'/'}

        const {details} = await parser.import(fileInfo)
        

        expect(details.video?.file).toBe(`video:///__tests__/data/rlv/ES_Andalusia-1.avi`)    

    })

})