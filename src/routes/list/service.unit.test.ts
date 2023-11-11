import { ApiClient } from '../../api';
import { DEFAULT_ROUTE_API } from '../base/api/consts';
import {RouteListService} from './service'
import { List, Route } from './types';

ApiClient.getInstance().init({version:'0.6',uuid:'test',appVersion:'1.0', apiKey:'123'})

class Test extends RouteListService {

    async loadRouteDescriptions() {
        return await super.loadRouteDescriptions()
    }

    logError(err:Error,fn:string,args) {
        console.log('ERROR fn', fn, err,...args)
    }

    getRoutes() {
        return this.routes
    }

    addToRouteList( list:List, routes:Array<Route>) {
        const l = this.routes.find( rle=> rle.list===list)
        if (l)
            l.routes = routes
        else {
            this.routes.push( {list,routes})
        }
        
    }

    constructor() {
        super();

        this.api['getBaseUrl']=jest.fn().mockReturnValue(DEFAULT_ROUTE_API)
    }


}




describe('RouteListService',()=>{


    describe('start',()=>{

        let svc:Test
        const onStatusUpdate = jest.fn()
        beforeEach( ()=>{
            svc = new Test()    
        })

        test('selected and alternatives',async ()=>{

            svc.addToRouteList('myRoutes',[])
            svc.addToRouteList('selected',[ 
                {id:'1', data:{title:'Video1', state:'prepared'}},
                {id:'2', data:{title:'Video2', state:'prepared'}}
            ])
            svc.addToRouteList('alternatives',[ 
                {id:'3', data:{title:'Video3', state:'loaded'}}
            ])


            const data = svc.start('1',{onStatusUpdate,language:'de'})

            expect(data.lists.map(l=>l.listHeader).join(',')).toEqual('Selected For Me,Alternatives' )
            expect(data.lists[0].list).toEqual('selected')
            expect(data.lists[0].routes).toEqual( [{title:'Video1', state:'prepared'}, {title:'Video2', state:'prepared'}])
            expect(data.lists[1].list).toEqual('alternatives')
            expect(data.lists[1].routes).toEqual( [{title:'Video3', state:'loaded'}])
            expect(data.pageId).toBe('1')




        })

        test('nothing loaded',async ()=>{

            const data = svc.start('1',{onStatusUpdate,language:'de'})

            expect(data.lists.length).toEqual(0)




        })





    })

    describe('preload',()=>{

        let svc:Test
        beforeEach( ()=>{
            svc = new Test()    
        })

        test('success',async ()=>{

            await svc.preload()
            console.log( svc.getRoutes())

        })





    })



    test('loadRouteDescriptions',async ()=>{
        const svc = new Test()
        await svc.loadRouteDescriptions();
        
        svc.getRoutes().forEach( rle=> {
            console.log( `${rle.list}:\n`,rle.routes.map( r=> `${r.data.country}:${r.data.title}`))
        })
        
        
    })
})