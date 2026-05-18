import {OptionManager} from "./options";
import {useMapArea} from "./service"
import {DEFAULT_POSITION, DEFAULT_RADIUS} from './consts'
import t1 from '../../../__tests__/data/overpass/default-location.json'
import t2 from '../../../__tests__/data/overpass/default-2.json'
import t3 from '../../../__tests__/data/overpass/default-3.json'
import t4 from '../../../__tests__/data/overpass/miami.json'
import t5 from '../../../__tests__/data/overpass/garden-issue1.json'

import { MapArea } from "./MapArea";
import { getBounds, getPointCrossingPath } from "./utils";
import { LatLng } from "../../utils/geo";
import { IncyclistWay, IncyclistNode, PathCrossingInfo } from "./types";


const defaultData = t1 as unknown as JSON
const defaultData2 = t2 as unknown as JSON
const defaultData3 = t3 as unknown as JSON
const miamiData = t4 as unknown as JSON
const gardenData = t5 as unknown as JSON

describe('OptionManager',()=>{

    const pathInfo = (path:any) => '['+path.map( (p:any)=>p.id??`{lat:${p.lat.toFixed(4)},lng:${p.lng.toFixed(4)}}`).join(',')+']'



    describe ('getStartOptions',()=>{

        let manager: OptionManager
        let map:MapArea

        const setup  = async (data:any,location:any,maps?:Record<string,object>)=> {
            const mapData = useMapArea().createMapData(data)
            const boundary = getBounds(location.lat,location.lng,DEFAULT_RADIUS)

            useMapArea().load = jest.fn( async (location) =>  {
                if (maps?.[location.id??'']) {
                    const d = maps[location.id??''] as JSON
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

            
            const result = await manager.getNextOptions(options[1])
            const res = result.options

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

        test('Paris issue - single-way roundabout with same-route option (mocked data)',async ()=>{
            // This test reproduces the Paris scenario where getNextOptions returns a single option
            // with the same ID as the segment, which triggered: "Cannot read properties of undefined (reading 'path')"
            // Issue: line 38 had !== instead of ===, and line 44 used options[0] instead of opts[0]

            // Minimal mocked data based on the captured test data
            const location = {lat: 48.8788819, lng: 2.3785022, id: '987604377', ways: ['85147125', '85147129']}

            const node1 = {id: '987604377', lat: 48.8788819, lng: 2.3785022, ways: ['85147125', '85147129']}
            const node2 = {id: '2362794816', lat: 0, lng: 0, ways: ['85147125']}
            const node3 = {id: '987604416', lat: 0, lng: 0, ways: ['85147125']}
            const node4 = {id: '2362794821', lat: 0, lng: 0, ways: ['85147125']}
            const node5 = {id: '8898342773', lat: 0, lng: 0, ways: ['85147125']}
            const node6 = {id: '8898342779', lat: 0, lng: 0, ways: ['85147125']}

            // The roundabout way
            const roundaboutWay: IncyclistWay = {
                id: '85147125',
                type: 'way',
                name: undefined,
                bounds: undefined,
                tags: {
                    junction: 'circular',
                    highway: 'residential',
                    oneway: 'yes'
                },
                path: [node1, node2, node3, node4, node5, node6]
            }

            const crossing: PathCrossingInfo = {
                point: location,
                distance: 0,
                idx: 0
            }

            // Use setup with mocked maps
            const mockMapData = {elements: [], version: 0.6, generator: 'test'} as any
            const maps = {
                '987604377': mockMapData
            }
            setup(mockMapData, location, maps)

            // Create a simple mock map for this test
            const mockMap = new MapArea(mockMapData, location, getBounds(location.lat, location.lng, DEFAULT_RADIUS))
            mockMap.getWay = jest.fn((id: string) => {
                if (id === '85147125') return roundaboutWay
                return undefined
            })
            mockMap.getNode = jest.fn((id: string) => {
                const nodes: Record<string, IncyclistNode> = {
                    '987604377': node1,
                    '2362794816': node2,
                    '987604416': node3,
                    '2362794821': node4,
                    '8898342773': node5,
                    '8898342779': node6
                }
                return nodes[id]
            })
            mockMap.splitAtCrossingPoint = jest.fn(() => [])
            mockMap.buildSegmentInfo = jest.fn(() => ({
                segments: [{
                    id: '85147125',
                    path: [node1, node2, node3, node4, node5, node6]
                }],
                points: [location]
            }))

            manager.setMap(mockMap)

            // Mock getNextOptions to return a single option with the same ID
            // This is the scenario that triggered the bug
            jest.spyOn(manager, 'getNextOptions').mockResolvedValue({
                options: [{
                    id: '85147125',  // Same as segment ID - this is the key issue
                    path: [node1, node2],
                    map: mockMap
                }],
                isValid: true
            })

            // Call getStartOptions - should not throw or log errors
            const options = await manager.getStartOptions(roundaboutWay, crossing)

            // Verify it returns valid options
            expect(Array.isArray(options)).toBe(true)
            expect(options.length).toBeGreaterThan(0)
            // Note: cleanup happens in afterEach via jest.restoreAllMocks()

        })

    })


    describe ('getNextOptions',()=>{

        let manager: OptionManager
        let map: MapArea

        const setup  = async (data:JSON,location:LatLng,maps?:Record<string,object>)=> {
            const mapData = useMapArea().createMapData(data)
            const boundary = getBounds(location.lat,location.lng,DEFAULT_RADIUS)

            useMapArea().load = jest.fn( async (location) =>  {
                if (maps?.[location.id??'']) {
                    const d = maps[location.id??''] as JSON
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