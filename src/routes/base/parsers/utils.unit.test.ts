import path from "path"
import { FileInfo, getBindings } from "../../../api"
import { getReferencedFileInfo } from "./utils"

describe('Incyclist Parser Utils',()=>{

    describe('getReferencedFileInfo',()=>{

        beforeAll( ()=>{
            getBindings().path = path
        })

        test('local file system with default scheme',()=>{
            const name= 'test.xml'
            const dir = '/tmp'
            const filename = `${dir}/${name}`

            const fileInfo:FileInfo = {type:'file', filename, name, ext:'xml',dir,url:undefined, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.gpx'})
            expect(res).toBe('file:////tmp/test.gpx')
        })
        test('local file system with video scheme',()=>{
            const name= 'test.xml'
            const dir = '/tmp'
            const filename = `${dir}/${name}`

            const fileInfo:FileInfo = {type:'file', filename, name, ext:'xml',dir,url:undefined, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.mp4'},'video')
            expect(res).toBe('file:////tmp/test.mp4')
        })
        test('file scheme URL with file scheme as target',()=>{
            const name= 'test.xml'
            const dir = '/tmp'

            const fileInfo:FileInfo = {type:'url', filename:undefined, name, ext:'xml',dir,url:`file:///${dir}/${name}`, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.gpx'})
            expect(res).toBe('file:////tmp/test.gpx')
        })
        test('file scheme URL with video scheme as target',()=>{
            const name= 'test.xml'
            const dir = '/tmp'

            const fileInfo:FileInfo = {type:'url', filename:undefined, name, ext:'xml',dir,url:`file:///${dir}/${name}`, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.mp4'},'video')
            expect(res).toBe('video:////tmp/test.mp4')
        })

        test('file scheme URL with relative path',()=>{
            const name= 'test.xml'
            const dir = '/tmp'

            const fileInfo:FileInfo = {type:'url', filename:undefined, name, ext:'xml',dir,url:`file:///${dir}/${name}`, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'../test.gpx'})
            expect(res).toBe('file:////test.gpx')
        })

    })
})