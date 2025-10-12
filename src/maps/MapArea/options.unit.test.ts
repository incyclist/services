import {OptionManager} from "./options";
import {useMapArea} from "./service"
import {DEFAULT_POSITION, DEFAULT_RADIUS} from './consts'
import defaultData from '../../../__tests__/data/overpass/default-location.json'
import defaultData2 from '../../../__tests__/data/overpass/default-2.json'
import defaultData3 from '../../../__tests__/data/overpass/default-3.json'
import miamiData from '../../../__tests__/data/overpass/miami.json'
import gardenData from '../../../__tests__/data/overpass/garden-issue1.json'

import { MapArea } from "./MapArea";
import { getBounds, getPointCrossingPath } from "./utils";

describe('OptionManager',()=>{

    const pathInfo = (path:any) => '['+path.map(p=>p.id??`{lat:${p.lat.toFixed(4)},lng:${p.lng.toFixed(4)}}`).join(',')+']'



    describe ('getStartOptions',()=>{

        let manager: OptionManager
        let map:MapArea

        const setup  = async (data:any,location:any,maps?:Record<string,object>)=> {
            const mapData = useMapArea().createMapData(data)
            const boundary = getBounds(location.lat,location.lng,DEFAULT_RADIUS)

            useMapArea().load = jest.fn( async (location) =>  {
                if (maps?.[location.id??'']) {
                    const d = maps[location.id??'']
                    return new MapArea(useMapArea().createMapData(d),location,boundary)                    
                }
                return new MapArea(mapData,location,boundary)
            })

            map = new MapArea(mapData,location,boundary)
            manager = new OptionManager(useMapArea(), map)            
        }

        afterEach( () => {
            useMapArea().reset()
            jest.restoreAllMocks()
        })

        test('default location',async ()=>{
            const location = DEFAULT_POSITION

            setup(defaultData,location)
            const way = map.getWay('82696507')
            const crossing = getPointCrossingPath(location, way.path,true)
            
            const res = await manager.getStartOptions(way,crossing)

            expect(pathInfo(res[0].path)).toEqual('[{lat:26.6854,lng:-80.0348},7539895026,8498961197,8498961210,99836339]') 
            expect(pathInfo(res[1].path)).toEqual('[{lat:26.6854,lng:-80.0348},99887563,99887565,99887567]')

        })

        test('bugfix: incorrect options given at -34.305, 18.826',async ()=>{
            const location = {lat: -34.305075359846555,lng: 18.82589606633218}
            setup(gardenData, location)

            const way = map.getWay('261772478')
            const crossing = getPointCrossingPath(location, way.path,true)
            const options = await manager.getStartOptions(way,crossing)

            
            const res = await manager.getNextOptions(options[1])

            expect(res.length).toBe(2)
            expect(res[1].path[1].id).toBe('1028491949')
            expect(res[1].path[res[1].path.length-1].id).toBe('29386619')

            
            expect(res[0].path[1].id).toBe('2292003367')
            expect(res[0].path[res[0].path.length-1].id).toBe('29386619')

        })
        // {
 

        test('at end of street, should check continuation',async ()=>{

            const location = {lat:26.705056385158873,lng:-80.0333565481641} // between node 5499384959 and 12375134635 
            const maps = {
                '12375134635':defaultData2,
                '99716395':defaultData3
            }
            setup(defaultData,location,maps)
            const way = map.getWay('82696507')  // https://www.openstreetmap.org/way/82696507
            const crossing = getPointCrossingPath(location, way.path,true)
            
            const res = await manager.getStartOptions(way,crossing)

            expect(pathInfo(res[1].path)).toEqual('[{lat:26.7051,lng:-80.0333},5499384959,99628306,99656394,99887521,5077945148,99709224,99755546,5077905520,99751778,5077905518,11240951476,99887526,5494360086,5077945136,99887528,99656765,99750605,99716395]')
            expect(pathInfo(res[0].path)).toEqual('[{lat:26.7051,lng:-80.0333},12375134635,12375134633,2887773398,99887518]') 


        })

        test('at roundabout',async ()=>{
            // TODO
        })

    })


    describe ('getNextOptions',()=>{

        let manager: OptionManager
        let map

        const setup  = async (data,location,maps?:Record<string,object>)=> {
            const mapData = useMapArea().createMapData(data)
            const boundary = getBounds(location.lat,location.lng,DEFAULT_RADIUS)

            useMapArea().load = jest.fn( async (location) =>  {
                if (maps?.[location.id??'']) {
                    const d = maps[location.id??'']
                    return new MapArea(useMapArea().createMapData(d),location,boundary)                    
                }
                return new MapArea(mapData,location,boundary)
            })

            map = new MapArea(mapData,location,boundary)
            manager = new OptionManager(useMapArea(), map)            
        }

        afterEach( () => {
            useMapArea().reset()
            jest.restoreAllMocks()
        })






        // already covered in getStartOptions:
        // - test('options on same way - source is not a roundabout',async ()=>{})
        // - test('options on different way - final point crosses another way at its first point',async ()=>{})
        // - test('options on different way - final point crosses another way at its last point',async ()=>{})

        test('options on same way - source is within roundabout',async ()=>{})

        test('options on different way - source is within roundabout',async ()=>{})

        test('options on different way - final point crosses another way in the middle',async ()=>{})


        test('exceptional: no way specified',async ()=>{})
        test('exceptional: no map available',async ()=>{})


        // test: ID = 11131747 [2909525041...99155348]
        // map: 25.7780433,-80.2247692:804.9522744528823,[25.78527435125909,-80.21673903037001,25.77081224874091,-80.23279936962999]
        test('miami area',async ()=>{


            // TEST 1: incorrect options - shoould remain on street, but prefers to turn left
            // way: 398329013
            // path: 99163486...99155346
            // map: 25.778108,-80.2227711:804.9522744528823,[25.78533905125909,-80.2147409259907,25.77087694874091,-80.23080127400931]


            // TEST 2: incorrect options - shou
            // way: 11131747
            // path: {lat:25.777968763775107,lng:-80.22714213059686}...99155350
            // map: 25.77796876376968,-80.22714213073402:1000,[25.786951968723052,-80.21716617956304,25.76898555881631,-80.23711808190501]



            
            setup(miamiData,{lat:25.7780433,lng:-80.2247692})

            const way = map.getWay('11131747')
            const node = map.getNode('99155350')
            const path = [  {lat:25.777968763775107,lng:-80.22714213059686},node]
            const option = {id:'11131747',path,color:'green', text:'West'}

            const res = await manager.getNextOptions(option)
            


            // const crossing = getPointCrossingPath(location, way.path,true)
            
            // const res = await manager.getStartOptions(way,crossing)

            // expect(pathInfo(res[0].path)).toEqual('[{lat:26.6854,lng:-80.0348},7539895026,8498961197,8498961210,99836339]') 
            // expect(pathInfo(res[1].path)).toEqual('[{lat:26.6854,lng:-80.0348},99887563,99887565,99887567]')

        })


    })


})