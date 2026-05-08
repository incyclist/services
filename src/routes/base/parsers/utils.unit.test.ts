import path from "path"
import { FileInfo, getBindings } from "../../../api"
import { getReferencedFileInfo } from "./utils"

describe('Incyclist Parser Utils',()=>{

    describe('getReferencedFileInfo',()=>{

        beforeAll( ()=>{
            getBindings().path = path
        })

        test('local file system with default scheme',()=>{
            const name= 'test'
            const base= 'test.xml'
            const dir = '/tmp'
            const filename = `${dir}/${base}`

            const fileInfo:FileInfo = {type:'file', filename, name, base, ext:'xml',dir,url:undefined, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.gpx'})
            expect(res).toBe('file:///tmp/test.gpx')
        })
        test('local file system with video scheme',()=>{
            const name= 'test'
            const base= 'test.xml'
            const dir = '/tmp'
            const filename = `${dir}/${base}`

            const fileInfo:FileInfo = {type:'file', filename, name,base, ext:'xml',dir,url:undefined, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.mp4'},'video')
            expect(res).toBe('file:///tmp/test.mp4')
        })
        test('file scheme URL with file scheme as target',()=>{
            const name= 'test'
            const base= 'test.xml'
            const dir = '/tmp'

            const fileInfo:FileInfo = {type:'url', filename:undefined, name, base, ext:'xml',dir,url:`file://${dir}/${base}`, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.gpx'})
            expect(res).toBe('file:///tmp/test.gpx')
        })
        test('file scheme URL with video scheme as target',()=>{
            const name= 'test'
            const base= 'test.xml'
            const dir = '/tmp'

            const fileInfo:FileInfo = {type:'url', filename:undefined, name, base, ext:'xml',dir,url:`file://${dir}/${base}`, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'test.mp4'},'video')
            expect(res).toBe('video:///tmp/test.mp4')
        })

        test('file scheme URL with relative path',()=>{
            const name= 'test'
            const base= 'test.xml'
            const dir = '/tmp'

            const fileInfo:FileInfo = {type:'url', filename:undefined, name, base, ext:'xml',dir,url:`file://${dir}/${base}`, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{file:'../test.gpx'})
            expect(res).toBe('file:///test.gpx')
        })

        test('neither file nor URL is specified',()=>{
            const name= 'test'
            const base= 'test.xml'
            const dir = '/tmp'

            const fileInfo:FileInfo = {type:'url', filename:undefined, name,base, ext:'xml',dir,url:`file:///${dir}/${name}`, delimiter:'/'}

            const res = getReferencedFileInfo(fileInfo,{})
            expect(res).toBeUndefined()

        })

        describe('Linux absolute paths', () => {
            test('referenced file in same directory',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'/home/user/routes/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'/home/user/routes', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'route.gpx'})
                expect(res).toBe('file:///home/user/routes/route.gpx')
            })

            test('referenced file in parent directory',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'/home/user/routes/subdir/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'/home/user/routes/subdir', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'../route.gpx'})
                // Returns file:// URL with absolute path (not normalized)
                expect(res).toBe('file:///home/user/routes/subdir/../route.gpx')
            })

            test('referenced file with relative ./ prefix',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'/home/user/routes/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'/home/user/routes', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'./route.gpx'})
                // Returns file:// URL with absolute path (not normalized)
                expect(res).toBe('file:///home/user/routes/./route.gpx')
            })

            test('referenced file in nested relative path',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'/home/user/routes/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'/home/user/routes', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'./videos/route.mp4'})
                // Returns file:// URL with absolute path (not normalized)
                expect(res).toBe('file:///home/user/routes/./videos/route.mp4')
            })
        })

        describe('Windows absolute paths', () => {
            test('Windows path with forward slashes',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'C:/Users/user/routes/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'C:/Users/user/routes', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'route.gpx'})
                // Windows drive letter paths get 3 slashes: file:///C:/...
                expect(res).toBe('file:///C:/Users/user/routes/route.gpx')
            })

            test('Windows path in parent directory',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'C:/Users/user/routes/subdir/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'C:/Users/user/routes/subdir', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'../route.gpx'})
                // Returns file:// URL with Windows absolute path (not normalized)
                expect(res).toBe('file:///C:/Users/user/routes/subdir/../route.gpx')
            })

            test('Windows path with relative ./ prefix',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'C:/Users/user/routes/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'C:/Users/user/routes', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'./route.gpx'})
                // Returns file:// URL with Windows absolute path (not normalized)
                expect(res).toBe('file:///C:/Users/user/routes/./route.gpx')
            })
        })

        describe('Relative paths (info.type=file)', () => {
            test('relative path without ./ prefix',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'./__tests__/data/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'./__tests__/data', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'route.gpx'})
                // Always returns URL: file:// + relative path
                expect(res).toBe('file://./__tests__/data/route.gpx')
            })

            test('relative path with ./ prefix',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'./__tests__/data/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'./__tests__/data', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'./route.gpx'})
                // Always returns URL: file:// + relative path (not normalized)
                expect(res).toBe('file://./__tests__/data/./route.gpx')
            })

            test('relative path with ../ prefix',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'./__tests__/data/subdir/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'./__tests__/data/subdir', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'../route.gpx'})
                // Always returns URL: file:// + relative path (not normalized)
                expect(res).toBe('file://./__tests__/data/subdir/../route.gpx')
            })

            test('relative path with nested directory',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'./__tests__/data/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'./__tests__/data', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'./videos/route.mp4'})
                // Always returns URL: file:// + relative path (not normalized)
                expect(res).toBe('file://./__tests__/data/./videos/route.mp4')
            })
        })

        describe('URL-based references (info.type=url)', () => {
            test('Linux file URL with relative reference',()=>{
                const fileInfo:FileInfo = {type:'url', filename:undefined, name:'route', base:'route.xml', ext:'xml', dir:'/home/user/routes', url:'file:///home/user/routes/route.xml', delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'./route.mp4'})
                // For URL-based references with relative paths, uses buildRelativePathTarget
                expect(res).toMatch(/file:.*route\.mp4$/)
            })

            test('incyclist scheme URL with filename only',()=>{
                const fileInfo:FileInfo = {type:'url', filename:undefined, name:'route', base:'route.xml', ext:'xml', dir:'/data', url:'incyclist:///data/route.xml', delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'video.mp4'})
                // For filename without path separators, uses buildAbsolutePathTarget which preserves scheme
                expect(res).toBe('incyclist:///data/video.mp4')
            })
        })

        describe('HTTP URLs', () => {
            test('HTTP URL reference is returned as-is',()=>{
                const fileInfo:FileInfo = {type:'url', filename:undefined, name:'route', base:'route.xml', ext:'xml', dir:'', url:'file:///home/user/routes/route.xml', delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'http://example.com/route.gpx'})
                expect(res).toBe('http://example.com/route.gpx')
            })

            test('HTTPS URL reference is returned as-is',()=>{
                const fileInfo:FileInfo = {type:'url', filename:undefined, name:'route', base:'route.xml', ext:'xml', dir:'', url:'file:///home/user/routes/route.xml', delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'https://secure.example.com/route.gpx'})
                expect(res).toBe('https://secure.example.com/route.gpx')
            })
        })

        describe('URL references (referenced.url)', () => {
            test('URL reference takes precedence over file',()=>{
                const fileInfo:FileInfo = {type:'file', filename:'/home/user/routes/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'/home/user/routes', url:undefined, delimiter:'/'}
                const res = getReferencedFileInfo(fileInfo, {file:'ignored.gpx', url:'https://example.com/route.gpx'})
                expect(res).toBe('https://example.com/route.gpx')
            })
        })

    })
})