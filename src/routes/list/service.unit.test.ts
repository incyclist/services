import { RoutesDbLoader } from "./loaders/db";
import repoData from '../../../__tests__/data/db/db.json'
import { RouteInfoDBEntry } from "./loaders/types";
import { RouteListService } from "./service";
import { getBindings } from "../../api";
import path from "path";
import os from "os"
import { IAppInfo } from "../../api/appInfo";
import fs from 'fs/promises'
import { IFileSystem } from "../../api/fs";

describe('RouteListService',()=>{

    class MockeableService extends RouteListService {
        public async loadRoutesFromApi(): Promise<void> {
            return await super.loadRoutesFromApi()
        }
    }


    describe('preload',()=>{

        let db
        let service:MockeableService



        beforeEach(()=>{ 
            const data = repoData as unknown as Array<RouteInfoDBEntry>
            db = new RoutesDbLoader()
            
            db.loadDetails = jest.fn()
            db.loadDescriptions = jest.fn().mockResolvedValue(data)
            db.write = jest.fn()
            db.isCompleted = jest.fn().mockReturnValue(true)
            
            service = new MockeableService()            
            service.loadRoutesFromApi = jest.fn().mockResolvedValue([])

            const filesystem = fs as unknown as IFileSystem;
            getBindings().path = path;
            getBindings().fs = filesystem
            getBindings().video = {
                isScreenshotSuported:jest.fn().mockReturnValue(true),
                isConvertSuported:jest.fn().mockReturnValue(true),
                screenshot:jest.fn().mockResolvedValue('screenshot'),
                convert:jest.fn()

            }
            filesystem.checkDir = jest.fn()
    
            getBindings().appInfo = {
                getAppDir:jest.fn().mockReturnValue(os.tmpdir())
            } as unknown as IAppInfo
        })

        afterEach( ()=>{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (service as any).reset()
            db.reset()
        })

        test('1',async ()=>{

            const sort = (a,b) => a.id<b.id ? -1 : 1
            const observer = await service.preload()
            await observer.wait()

            const routes = service.search()
            expect(routes.length).toBe(34)

            routes.forEach( r => {delete r.observer})
            expect(routes.sort(sort)).toMatchObject(repoData.sort(sort))
            

        })


    })
})