import path from "path"
import { FileInfo, getBindings } from "../../../api"
import { buildVideoUrl, getReferencedFileInfo, openRouteFile } from "./utils"
import { Inject } from "../../../base/decorators"
import { RouteImportError, isImportCancelled, setImportCancelledCheck } from "../../../fileaccess/externalFiles"
import { createFileAccessBindingMock, FileAccessBindingMock } from "../../../../__tests__/utils/fileAccessMock"

describe('Incyclist Parser Utils',()=>{

    describe('buildVideoUrl',()=>{
        test('Unix absolute path produces a 3-slash video:// URL',()=>{
            const res = buildVideoUrl('/storage/emulated/0/Android/data/com.incyclist.app/files/videos/FR_Galibier_Demo.mp4')
            expect(res).toBe('video:///storage/emulated/0/Android/data/com.incyclist.app/files/videos/FR_Galibier_Demo.mp4')
        })

        test('Windows absolute path (backslash) produces a 3-slash video:// URL',()=>{
            const res = buildVideoUrl('D:\\RLV-Training\\RLV\\ES_Andalusia-1\\ES_Andalusia-1.avi')
            expect(res).toBe('video:///D:\\RLV-Training\\RLV\\ES_Andalusia-1\\ES_Andalusia-1.avi')
        })

        test('Windows absolute path (forward slash) produces a 3-slash video:// URL',()=>{
            const res = buildVideoUrl('C:/Users/user/videos/route.mp4')
            expect(res).toBe('video:///C:/Users/user/videos/route.mp4')
        })

        test('relative path produces a 2-slash video:// URL',()=>{
            const res = buildVideoUrl('./__tests__/data/rlv/IS_West.avi')
            expect(res).toBe('video://./__tests__/data/rlv/IS_West.avi')
        })
    })

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

        // Regression coverage for handleFileUrlPath() / buildUrlFromFile(): when info.filename is
        // already a `file://`-prefixed URL (e.g. discovered via a mobile folder scan), substituting
        // in a referenced companion file and rebuilding the URL must be a no-op on slash count for
        // every path shape - it must not gain or lose a slash relative to the original.
        describe('already file://-prefixed filename (round trip through handleFileUrlPath)', () => {
            test('Unix absolute path keeps exactly 3 slashes after substitution',()=>{
                const dir = '/private/var/mobile/Containers/Data/Application/ABC/Documents/routes'
                const base = 'route.xml'
                const fileInfo:FileInfo = {type:'file', filename:`file://${dir}/${base}`, name:'route', base, ext:'xml', dir, url:undefined, delimiter:'/'}

                const res = getReferencedFileInfo(fileInfo, {file:'video.mp4'})
                expect(res).toBe(`file://${dir}/video.mp4`)
                expect(res).toBe('file:///private/var/mobile/Containers/Data/Application/ABC/Documents/routes/video.mp4')
            })

            test('Windows drive-letter absolute path keeps exactly 3 slashes after substitution',()=>{
                const dir = 'C:/Users/user/Documents/routes'
                const base = 'route.xml'
                const fileInfo:FileInfo = {type:'file', filename:`file:///${dir}/${base}`, name:'route', base, ext:'xml', dir, url:undefined, delimiter:'/'}

                const res = getReferencedFileInfo(fileInfo, {file:'video.mp4'})
                expect(res).toBe(`file:///${dir}/video.mp4`)
            })

            test('relative path keeps exactly 2 slashes after substitution',()=>{
                const dir = './__tests__/data'
                const base = 'route.xml'
                const fileInfo:FileInfo = {type:'file', filename:`file://${dir}/${base}`, name:'route', base, ext:'xml', dir, url:undefined, delimiter:'/'}

                const res = getReferencedFileInfo(fileInfo, {file:'video.mp4'})
                expect(res).toBe(`file://${dir}/video.mp4`)
            })

            test('exact malformed-vs-correct example from the bug report',()=>{
                const dir = '/private/var/mobile/Containers/Data/Application/ABC/Documents/routes'
                const base = 'route.xml'
                const fileInfo:FileInfo = {type:'file', filename:`file://${dir}/${base}`, name:'route', base, ext:'xml', dir, url:undefined, delimiter:'/'}

                const res = getReferencedFileInfo(fileInfo, {file:'video.mp4'})

                // Correct: file:// (scheme) + /private/... (path's own leading slash) = 3 slashes total
                expect(res).toBe('file:///private/var/mobile/Containers/Data/Application/ABC/Documents/routes/video.mp4')
                // Must NOT regress to the malformed 2-slash form the bug produced
                expect(res).not.toBe('file://private/var/mobile/Containers/Data/Application/ABC/Documents/routes/video.mp4')
            })
        })

    })

    describe('openRouteFile',()=>{

        const file:FileInfo = {type:'file', filename:'/icloud/routes/route.xml', name:'route', base:'route.xml', ext:'xml', dir:'/icloud/routes', url:undefined, delimiter:'/'}

        let binding:FileAccessBindingMock
        let loaderOpen:jest.Mock

        beforeEach(()=>{
            binding = createFileAccessBindingMock({ classifyLocation: jest.fn().mockReturnValue('icloud') })
            loaderOpen = jest.fn().mockResolvedValue({ data: '<xml/>' })

            // openRouteFile() reads the plain, non-injected getBindings() both for ensureLocal's
            // own binding lookup (ExternalFileService.getBindings() falls through to it whenever
            // nothing is Inject()-ed) and for the final loader.open() call.
            getBindings().fileAccess = binding
            getBindings().loader = { open: loaderOpen }
        })

        afterEach(()=>{
            delete (getBindings() as any).fileAccess
            Inject('OnlineStatus', null)
            setImportCancelledCheck(()=>false)
            jest.clearAllMocks()
        })

        test('no binding at all -> calls loader.open(file) unchanged, exactly like today',async ()=>{
            delete (getBindings() as any).fileAccess

            const res = await openRouteFile(file)

            expect(loaderOpen).toHaveBeenCalledWith(file)
            expect(loaderOpen).toHaveBeenCalledTimes(1)
            expect(res).toEqual({ data: '<xml/>' })
        })

        test('local (non-icloud) file -> calls loader.open(file) unchanged',async ()=>{
            binding.classifyLocation.mockReturnValue('on-device')

            const res = await openRouteFile(file)

            expect(loaderOpen).toHaveBeenCalledWith(file)
            expect(res).toEqual({ data: '<xml/>' })
        })

        test('file already local on iCloud -> calls loader.open(file) unchanged',async ()=>{
            binding.getAvailability.mockResolvedValue({ isUbiquitous: true, downloadStatus:'downloaded', isDownloading:false, downloadRequested:false })

            const res = await openRouteFile(file)

            expect(loaderOpen).toHaveBeenCalledWith(file)
            expect(res).toEqual({ data: '<xml/>' })
        })

        test('offline -> throws RouteImportError(ICLOUD_OFFLINE) without calling loader.open',async ()=>{
            binding.getAvailability.mockResolvedValue({ isUbiquitous:true, downloadStatus:'not-downloaded', isDownloading:false, downloadRequested:false })
            Inject('OnlineStatus', { onlineStatus:false })

            await expect(openRouteFile(file)).rejects.toMatchObject({
                code: 'ICLOUD_OFFLINE',
                message: expect.stringContaining('no internet connection')
            })
            expect(loaderOpen).not.toHaveBeenCalled()
        })

        test('download timed out -> throws RouteImportError(ICLOUD_DOWNLOAD_FAILED)',async ()=>{
            jest.useFakeTimers()
            binding.getAvailability.mockResolvedValue({ isUbiquitous:true, downloadStatus:'not-downloaded', isDownloading:false, downloadRequested:false })

            const promise = openRouteFile(file)
            const assertion = expect(promise).rejects.toMatchObject({ code:'ICLOUD_DOWNLOAD_FAILED' })
            await jest.advanceTimersByTimeAsync(10_000)
            await assertion

            jest.useRealTimers()
        })

        test('download itself fails -> throws RouteImportError(ICLOUD_DOWNLOAD_FAILED)',async ()=>{
            binding.getAvailability.mockResolvedValue({
                isUbiquitous:true, downloadStatus:'not-downloaded', isDownloading:false, downloadRequested:false,
                downloadError:{ domain:'NSURLErrorDomain', code:-1009 }
            })

            await expect(openRouteFile(file)).rejects.toMatchObject({ code:'ICLOUD_DOWNLOAD_FAILED' })
            expect(loaderOpen).not.toHaveBeenCalled()
        })

        test('access lost -> returns a FileLoaderResult error (not a throw), like a normal open failure',async ()=>{
            binding.checkAccess.mockResolvedValue({ state:'denied' })

            const res = await openRouteFile(file)

            expect(res.error).toBeDefined()
            expect(res.error.key).toBe('access-lost')
            expect(loaderOpen).not.toHaveBeenCalled()
        })

        test('not found -> returns a FileLoaderResult error (not a throw)',async ()=>{
            binding.checkAccess.mockResolvedValue({ state:'not-found' })

            const res = await openRouteFile(file)

            expect(res.error).toBeDefined()
            expect(res.error.key).toBe('not-found')
            expect(loaderOpen).not.toHaveBeenCalled()
        })

        test('cancelled via the library scanner flag -> returns a FileLoaderResult error',async ()=>{
            binding.getAvailability.mockResolvedValue({ isUbiquitous:true, downloadStatus:'not-downloaded', isDownloading:false, downloadRequested:false })
            setImportCancelledCheck(()=>true)

            const res = await openRouteFile(file)

            expect(res.error).toBeDefined()
            expect(res.error.key).toBe('cancelled')
            expect(loaderOpen).not.toHaveBeenCalled()
        })

        test('isImportCancelled() reflects the registered check',()=>{
            setImportCancelledCheck(()=>true)
            expect(isImportCancelled()).toBe(true)

            setImportCancelledCheck(()=>false)
            expect(isImportCancelled()).toBe(false)
        })
    })
})