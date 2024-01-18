import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo } from '../../../api'
import { parseXml } from '../utils/xml'
import {KWTParser} from './kwt'
import { XMLParser } from './xml'

describe('XMLParsers',()=>{
    let parser:XMLParser


    describe('KWT',()=>{

        
        beforeEach( ()=>{
            parser = new KWTParser()
        })

        test.skip('valid file',async ()=>{
            const file = './__tests__/data/rlv/DE_Schweighofen.xml'
            const xml = await loadFile('utf-8',file) as string
            const xmlJson = await parseXml(xml)
            const fileInfo:FileInfo = {type:'file', name:file, ext:'xml',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
            const {data,details} = await parser.import(fileInfo, xmlJson)
            expect(details.title).toBe('DE_Schweighofen')

            expect(data.title).toBe('Schweighofen')
            expect(data.country).toBe('DE')
            expect(data.id).toBe('25f28fa7419146deb765edc3d4e6a9ad')
            expect(data.videoFormat).toBe('mp4')
        })


        test('invalid file',async ()=>{
            const file = './__tests__/data/rlv/AU_Cape_Naturaliste.xml'
            const xml = await loadFile('utf-8',file) as string
            const fileInfo:FileInfo = {type:'file', name:file, ext:'xml',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
            const xmlJson = await parseXml(xml)

            await expect( async ()=> {await parser.import(fileInfo,xmlJson)}).rejects.toThrow('cannot parse <Track>')

            
       })

    })

})