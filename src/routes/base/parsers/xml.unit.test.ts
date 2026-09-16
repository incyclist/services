import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo, getBindings } from '../../../api'
import {KWTParser} from './kwt'
import { XMLParser } from './xml'

import path from 'path'
import fs from 'fs/promises'
import { IFileSystem } from '../../../api/fs'
import { parseXml } from '../../../utils'
import { createFileAccessBindingMock, FileAccessBindingMock } from '../../../../__tests__/utils/fileAccessMock'
import { Inject } from '../../../base/decorators'

describe('XMLParsers',()=>{
    let parser:XMLParser


    describe('KWT',()=>{

        
        beforeEach( ()=>{
            parser = new KWTParser()
            getBindings().path = path
            const mockFS = fs as unknown as IFileSystem
            mockFS.existsFile = async (path)=> { try { await fs.stat(path); return true} catch { return false}}
            mockFS.existsDir = async (path)=> { try { await fs.stat(path); return true} catch { return false}}
            getBindings().fs = mockFS

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

       test('invalid previewURL',async ()=>{
        const filename = './__tests__/data/rlv/DE_MauerDemo.xml'
        const xml = await loadFile('utf-8',filename) as string
        const fileInfo:FileInfo = {type:'file', filename, name:'DE_MauerDemo.xml', ext:'xml',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
        const xmlJson = await parseXml(xml)
        //const xmlJson = await parseXml(xml)
        const {data,details} = await parser.import(fileInfo,xmlJson)
        expect(details.previewUrl).toBeUndefined()
        expect(details.previewUrlLocal).toBeDefined()
        expect(data.previewUrl).toBeUndefined()

   })

    })

    describe('readAndDecode via openRouteFile (iCloud)',()=>{

        let binding:FileAccessBindingMock
        const fileInfo:FileInfo = {type:'file', filename:'/icloud/routes/route.xml', name:'route', base:'route.xml', ext:'xml',dir:'/icloud/routes',url:undefined, delimiter:'/'}

        beforeEach(()=>{
            parser = new KWTParser()
            binding = createFileAccessBindingMock({ classifyLocation: jest.fn().mockReturnValue('icloud') })
            getBindings().fileAccess = binding
        })

        afterEach(()=>{
            delete (getBindings() as any).fileAccess
            Inject('OnlineStatus', null)
        })

        test('a not-downloaded, offline iCloud file surfaces the iCloud reason, not the generic "Could not open" text',async ()=>{
            binding.getAvailability.mockResolvedValue({ isUbiquitous:true, downloadStatus:'not-downloaded', isDownloading:false, downloadRequested:false })
            Inject('OnlineStatus', { onlineStatus:false })

            await expect((parser as any).readAndDecode(fileInfo)).rejects.toMatchObject({
                code: 'ICLOUD_OFFLINE',
                message: expect.stringContaining('no internet connection')
            })
        })
    })

})