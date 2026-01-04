import fs from 'fs/promises';

import {useMapArea} from './service';
import testData from '../../../__tests__/data/overpass/MapArea-test1.json';
import defaultData from '../../../__tests__/data/overpass/default-location.json';
import roundaboutData from '../../../__tests__/data/overpass/roundabout-test.json';
import roundaboutIssuesData from '../../../__tests__/data/overpass/roundabout-issues.json';
import roundaboutIssue2 from '../../../__tests__/data/overpass/roundabout-issue2.json';

import { MapArea } from './MapArea';
import {  IncyclistNode, IncyclistWay, IncyclistWaySplit, PathCrossingInfo, WayInfo } from './types';
import { getPointCrossingPath, isOneWay } from './utils';
import { DEFAULT_FILTER } from './consts';


const printWay = (way:WayInfo) => {
    const info = way.id+'='+way.path.map((m) => `${m.id??'crossing'}`).join(',')
    return info
}

describe( 'MapArea', () => {
    describe ( 'constructor and getters', () => {

        let area:MapArea
        beforeEach(() => {           
            useMapArea().setFilter(DEFAULT_FILTER)
        });

        afterEach(() => {
            useMapArea().reset()
            jest.resetAllMocks()
        });

        test('normal flow', () => { 
            const location = { lat:1, lng:1 }
            const boundary = { northeast:{ lat:1, lng:1 }, southwest:{ lat:1, lng:1 } }

            useMapArea().setFilter(null)
            const data = useMapArea().createMapData(testData);           
            area = new MapArea(data, location, boundary);            

            expect(area.getQueryLocation()).toEqual(location);
            expect(area.getBoundary()).toEqual(boundary);
            expect(area.getStats()).toEqual({"footway": 1, "path": 1, "service": 1, "unclassified": 1});

            expect(area.getWays().map(w => w.id)).toMatchSnapshot()
            expect(area.getWay('4815077')).toMatchSnapshot()
            expect(area.getNode('30926693')).toMatchSnapshot()
            expect(area.getWay('non-existing')).toBeUndefined()
            expect(area.getNode('non-existing')).toBeUndefined()

        })

        test('with multi-way roundabouts', () => { 
            const location = { lat:47.73444191318148,lng:1.6481140252482982 }
            const boundary = { northeast:{ lat:1, lng:1 }, southwest:{ lat:1, lng:1 } } // not relevant
            const data = useMapArea().createMapData(roundaboutData);           
            area = new MapArea(data, location, boundary);            

            const roundabout = area.getWay('700616380')
            expect(roundabout).toBeUndefined()

            const multiNodeRB = area.getWays().find(w => w.id.startsWith('R:')&&w.id.split(',').includes('700616380')) ??{} as IncyclistWay
            expect(printWay(multiNodeRB)).toMatchSnapshot()
            
            

        })
        test('incorrect tagging in multi-way roundabouts', () => { 
            // 2nd part is not tagged as roundabout
            const location = { lat:36.1460519399368,lng:-5.342090963297901 }
            const boundary = { northeast:{ lat:1, lng:1 }, southwest:{ lat:1, lng:1 } } // not relevant
            const data = useMapArea().createMapData(roundaboutIssuesData);           
            area = new MapArea(data, location, boundary);            

            const roundabout = area.getWay('525571772')
            expect(roundabout).toBeUndefined()

            const multiNodeRB = area.getWays().find(w => w.id.startsWith('R:')&&w.id.split(',').includes('525571772')) ??{} as IncyclistWay
            expect(printWay(multiNodeRB)).toMatchSnapshot()
        })

        test('defect', () => { 
            // 2nd part is not tagged as roundabout
            const location = { lat:41.37009146958872,lng:2.1879956390742854}
            const boundary = { northeast:{ lat:1, lng:1 }, southwest:{ lat:1, lng:1 } } // not relevant

            const data = useMapArea().createMapData(roundaboutIssue2);
            area = new MapArea(data, location, boundary);            

            const roundabout = area.getWay('74975048')
            expect(roundabout).toBeUndefined()

            const multiNodeRB = area.getWays().find(w => w.id.startsWith('R:')&&w.id.split(',').includes('74975048')) ??{} as IncyclistWay
            expect(printWay(multiNodeRB)).toMatchSnapshot()
        })

    })

    describe ( 'is within boundary', () => {

        let area:MapArea
        beforeEach(() => {           
            useMapArea().setFilter(null)
        });

        afterEach(() => {
            useMapArea().reset()
            jest.resetAllMocks()
        });

        test('normal flow', () => { 
            const location = { lat:1, lng:1 }
            const boundary = { northeast:{ lat:20, lng:20 }, southwest:{ lat:0, lng:0 } }
            const data = useMapArea().createMapData(testData);           
            area = new MapArea(data, location, boundary);            

            expect(area.isWithinBoundary({ lat:1, lng:1 })).toBe(true);
            expect(area.isWithinBoundary({ lat:21, lng:1 })).toBe(false);
            expect(area.isWithinBoundary({ lat:-1, lng:2 })).toBe(false);
            expect(area.isWithinBoundary({ lat:10, lng:21 })).toBe(false);
            expect(area.isWithinBoundary({ lat:10, lng:-1 })).toBe(false);

        })


    })

    describe ( 'getNearestPath', () => {
        
        let area: MapArea;
        let data
        let testWays


        
        beforeEach(() => {           
            useMapArea().setFilter(null)
            data = useMapArea().createMapData(testData);
            testWays = data.ways;
            // position and bounds are irrelevant for this test
            area = new MapArea(data, { lat:0, lng:0 }, { northeast:{ lat:0, lng:0 }, southwest:{ lat:0, lng:0 } });            
        });

        afterEach(() => {
            useMapArea().reset()
            jest.resetAllMocks()
        });
    
    
        test ( 'on 1st point in path #1', () => {


            let res = area.getNearestPath( testWays[0].path[0]);
            expect ( res.path ).toBeDefined();
            expect ( res.distance ).toBe(0);
            expect ( res.path[0].lat ).toBe(testWays[0].path[0].lat);
            expect ( res.path[0].lng ).toBe(testWays[0].path[0].lng);
    
    
        } );
        test ( 'on 1st point in path #2', () => {
    
            let res = area.getNearestPath(testWays[1].path[0] );
            expect ( res.path ).toBeDefined();
            expect ( res.distance ).toBe(0);
            expect ( res.path[0].lat ).toBe(testWays[1].path[0].lat);
            expect ( res.path[0].lng ).toBe(testWays[1].path[0].lng);
    
    
        } );
        test ( 'rd point on 1st path', () => {
            let location = { lat: -16.7824429, lng: 145.6983982 };
            let res = area.getNearestPath(location );

            expect ( res.path ).toBeDefined();
            expect ( res.distance ).toBe(0);
            expect ( res.path[0].lat ).toBe(testWays[0].path[0].lat);
            expect ( res.path[0].lng ).toBe(testWays[0].path[0].lng);
            
        } );
    

        test ( 'two ways with same distance -> delivers first match', () => {
            const distanceToPathSpy = jest.spyOn(require('./utils'), 'distanceToPath').mockReturnValue(1);
    
            let location = { lat: -16.7824429, lng: 145.6983982 };
            const res = area.getNearestPath(location);
    
            expect(res.way.id).toBe('4815077');
            expect(res.distance).toBe(1);

            distanceToPathSpy.mockRestore();
        });

        test ( 'error: distanceToPath will have lowest value for way with highest id', () => {
            const distanceToPathSpy = jest.spyOn(require('./utils'), 'distanceToPath').mockImplementation((point,w) => { return 184561986-Number((w as IncyclistWay).id); });
    
            
            let location = { lat: -16.7824429, lng: 145.6983982 };
            const res = area.getNearestPath(location);
    
            expect(res.way.id).toBe('184561984');
            expect(res.distance).toBe(2)
            distanceToPathSpy.mockRestore();
    
        });

    
        test ( 'error: distanceToPath returns undefined', () => {
            const distanceToPathSpy = jest.spyOn(require('./utils'), 'distanceToPath').mockReturnValue(undefined);
    
            let location = { lat: -16.7824429, lng: 145.6983982 };
            const res = area.getNearestPath(location);
    
            expect(res.way).toBeUndefined()
            expect(res.distance).toBeUndefined();
            distanceToPathSpy.mockRestore();
    
        });


    });

    
    describe ( 'splitAtFirstBranch', () => {
        
        let area: MapArea;
        
        beforeEach(() => {           
            useMapArea().setFilter(null)
            const data = useMapArea().createMapData(defaultData);
            // position and bounds are irrelevant for this test
            const location = {lat: 26.685379666082877,lng: -80.03481961660714}
            const boundary = { northeast:{ lat:0, lng:0 }, southwest:{ lat:0, lng:0 } } // does not matter for this test
            area = new MapArea(data, location,boundary );            
        });

        afterEach(() => {
            useMapArea().reset()
            jest.resetAllMocks()
        });

        const addWay = (area,way) => {
            
            area.data.waysLookup[way.id] = way
            area.data.ways.push(way)
            for (const n of way.path) {
                if (!area.data.nodesLookup[n.id]) {
                    area.data.nodesLookup[n.id] = n                    
                }
            }
        }
    
    
        test.skip ( 'test to explore the data', () => {
            const node = area.getNode('7539895026')
            const ways = node?.ways??[]
            console.log(ways.map(m => `${area.getWay(m).id}:${area.getWay(m).name}`))

            const way = area.getWay('82696507')
            console.log(way.path.map((m,idx) => `${idx}:${m.id}:${m.lat},${m.lng},${m.ways?.length}`))
    
        } );

        test(('default location'),()=>{
            const way = area.getWay('82696507')
            const result = area.splitAtFirstBranch(way);

            expect(result.wayId).toBe('82696507')
            expect(result.path).toHaveLength(19)
            
            const info = result.branches?.map((b) => `${b.id}:`+b.path.map((m) => `${m.id}`).join(','))
            expect(info).toMatchSnapshot()
        })

        test(('street crossing a one way street'),()=>{
            const way = area.getWay('82696507')
            const node = way.path[2]

            // construct a one way street crossing the way (crossing point with '82696507' is last point of that way)
            // we are not allowed to drive into that one way street
            const oneWay:IncyclistWay = {
                id:'1234', name:'Dummy Ave',type:'way', 
                tags: {oneway:'yes', highway: 'residential'  },
                bounds:{minlat:0, maxlat:0, minlon:0, maxlon:0 },
                path:[
                { id: 'Dummy1', lat: -16.7824429, lng: 145.6983982, ways:['1234'] },
                { id: 'Dummy2', lat: -16.7824430, lng: 145.6983982, ways:['1234'] },
                node
            ]}
            node.ways?.push(oneWay.id)
            addWay(area,oneWay)
            
            const result = area.splitAtFirstBranch(way);
            expect(result.wayId).toBe('82696507')
            expect(result.path).toHaveLength(19)        // one way should be ignored, as we cannot drive into it            
        })


    });    


    describe ( 'splitAtCrossingPoint', () => {
        
        let area: MapArea;
        let data,location,boundary  
        
        beforeEach(() => {           
            // position and bounds are irrelevant for this test
            location = {lat: 26.685379666082877,lng: -80.03481961660714}
            boundary = { northeast:{ lat:0, lng:0 }, southwest:{ lat:0, lng:0 } } // does not matter for this test
        });

        afterEach(() => {
            useMapArea().reset()
            jest.resetAllMocks()
        });
    
        test.skip ( 'test to explore the data', () => {

            console.log('-------------------- TEST CASE SHOULD NOT BE PART OF A SUITE RUN')            
            expect(process.env.CI).toBeUndefined()  
            

            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const node = area.getNode('7539895026')
            const ways = node?.ways??[]
            console.log(ways.map(m => `${area.getWay(m).id}:${area.getWay(m).name}`))

            const way = area.getWay('82696507')
            console.log(way.path.map((m,idx) => `${idx}:${m.id}:${m.lat},${m.lng},${m.ways?.length}`))
    
        } );

    

        test(('default location'),()=>{
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const way = area.getWay('82696507')
            const first = way.path[0]
            const last = way.path[way.path.length-1]

            const crossing = getPointCrossingPath(location, way.path,true)
            const result = area.splitAtCrossingPoint(way, crossing);

            

            // Expected: 2 results
            // 1st: crossing point -> first point of way (in reverse order)
            // 2nd: crossing point -> last  point of way
            expect(result[0].wayId).toBe('82696507')
            expect(result[0].path?.[0]).toMatchObject(crossing.point)
            expect(result[0].path?.[result[0].path?.length-1]?.id).toEqual(first.id)

            expect(result[1].wayId).toBe('82696507')
            expect(result[0].path?.[0]).toMatchObject(crossing.point)
            expect(result[1].path?.[result[1].path?.length-1]?.id).toEqual(last.id)            
        })


        test(('crossing is close to last point'),()=>{
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const way = area.getWay('82696507')
            const first = way.path[0]
            const last = way.path[way.path.length-1]    // see https://www.openstreetmap.org/node/99649684

            const crossing = getPointCrossingPath(last, way.path,true)  
            crossing.distance = 10
            const result = area.splitAtCrossingPoint(way, crossing);

            // Expected: 3 results (as there are two streets crossing at the last point of the way)
            
            // 1st: crossing point -> first point of way (in reverse order)
            // 2nd: way crossing the street at last point
            // 2nd: way crossing the street at last point
            expect(result[0].wayId).toBe('82696507')
            expect(result[0].path?.[0]).toMatchObject(crossing.point)
            expect(result[0].path?.[result[0].path?.length-1]?.id).toEqual(first.id)

            expect(result[1].wayId).toBe('11205160')
            expect(result[2].wayId).toBe('47346032')
        })

        test(('crossing is exactly at first point, street crosses another street in the middle'),()=>{
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const way = area.getWay('11236601')
            const first = way.path[0]    // see https://www.openstreetmap.org/node/99836339
            const last = way.path[way.path.length-1]    

            const crossing = getPointCrossingPath(first, way.path,true)  
            const result = area.splitAtCrossingPoint(way, crossing);

            // Expected: 3 results (as there are is a streets crossing at the first point of the way)
            
            // 1st: way crossing the street at first point, from crossing->first (reversed)
            // 2nd: way crossing the street at first point, from crossing->last 
            // 3rd: full way 11236601
            expect(result[0].wayId).toBe('82696507')
            expect(result[1].wayId).toBe('82696507')
            
            expect(result[2].wayId).toBe('11236601')
            expect(result[2].path?.length).toEqual(way.path.length)
            expect(result[2].path?.[0]?.id).toEqual(first.id)
            expect(result[2].path?.[result[2].path?.length-1]?.id).toEqual(last.id)


        })

        test('crossing is exactly a point in the path of the one way street',()=>{ 
            
            useMapArea().setFilter(null)
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            
            
            const way = area.getWay('907331966')
            const {lat,lng,id:nodeId} = way.path[3]
            const last = way.path[way.path.length-1]

            const crossing = getPointCrossingPath({lat,lng}, way.path,true)  
            const result = area.splitAtCrossingPoint(way, crossing);
            
            expect(result).toHaveLength(1)
            expect(result[0].wayId).toBe('907331966')
            expect(result[0].path?.[0].id).toEqual(nodeId)
            expect(result[0].path?.[result[0].path?.length-1]?.id).toEqual(last.id)

        })



        test(('one way'),()=>{
            useMapArea().setFilter(null)    // if we apply filters, we would not find a oneway in this area
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const way = area.getWay('907331966')    // this is the new way route
            const last = way.path[way.path.length-1]
            const startPos = {lat:26.69212640839961,lng:-80.03713846327933}

            

            const crossing = getPointCrossingPath(startPos, way.path,true)
            const result = area.splitAtCrossingPoint(way, crossing);

            // Expected: 1 result
            // crossing point -> last  point of way
            expect(result).toHaveLength(1)

            expect(result[0].wayId).toBe('907331966')
            expect(result[0].path?.[0]).toMatchObject(crossing.point)
            expect(result[0].path?.[result[0].path?.length-1]?.id).toEqual(last.id)

        })


        test('implicit roundabout',()=>{
            useMapArea().setFilter(null)    // if we apply filters, we would not find a roundabout in this area
            useMapArea().setFilter(null)
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const way = area.getWay('1328903863')
            const startPos = {lat:26.676754683691712,lng:-80.03758371159269}
            const crossing = getPointCrossingPath(startPos, way.path,true)
            const first = way.path[0]
           
            const result = area.splitAtCrossingPoint(way, crossing);

            // Expected: 2 results
            // 1st: crossing point -> first point of way (in reverse order)
            // 2nd: crossing point -> first  point of way( = last point of way)
            expect(result[0].wayId).toBe('1328903863')
            expect(result[0].path?.[0]).toMatchObject(crossing.point)
            expect(result[0].path?.[result[0].path?.length-1]?.id).toEqual(first.id)

            expect(result[1].wayId).toBe('1328903863')
            expect(result[0].path?.[0]).toMatchObject(crossing.point)
            expect(result[1].path?.[result[1].path?.length-1]?.id).toEqual(first.id)            
        })


        // {lat:51.18043270952056,lng:6.40791009405025}

        

    });    

    describe ( 'buidlSegmentInfo', () => {
        
        let area: MapArea;
        let data,location,boundary  

        const prepareOptions = (wayId, crossingPoint, before,after) => {
            const result:IncyclistWaySplit[] = []
            let path:Array<IncyclistNode> = []
            if (before) {
                path.push (...before.map(n => area.getNode(n.toString())))                
                path.push(crossingPoint)
                result.push({wayId,path})
            }
            if (after) {
                path = [ crossingPoint  ]
                path.push (...after.map(n => area.getNode(n.toString())))                
                result.push({wayId,path})
                    
            }
            return result
            
        }

        
        beforeEach(() => {           
            // position and bounds are irrelevant for this test
            location = {lat: 26.685379666082877,lng: -80.03481961660714}
            boundary = { northeast:{ lat:0, lng:0 }, southwest:{ lat:0, lng:0 } } // does not matter for this test
        });

        afterEach(() => {
            useMapArea().reset()
            jest.resetAllMocks()
        });
   

        test(('default location'),()=>{
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const way = area.getWay('82696507')       // see https://www.openstreetmap.org/way/82696507     
            const startPos = {lat:26.685379666083794,lng: -80.03481961660702}            
            const before = [7539895026,8498961197,8498961210,99836339,99887561,99887560,99746466,99887559,99887557,99887555,99887552,99887550,99887548,99887546,99887544,6329797112,99887542,99887540,99887538,99887536,99887534,99887532,99887530,99855503,99735224,99713117,99716395,99750605,99656765,99887528,5077945136,5494360086,99887526,11240951476,5077905518,99751778,5077905520,99755546,99709224,5077945148,99887521,99656394,99628306,5499384959,12375134635]
            const after = [99887565,99887567,99887569,99649684]
            const paths:IncyclistWaySplit[] = prepareOptions(way.id, startPos, before, after)

            const res = area.buildSegmentInfo( way,paths)
            
            expect(res.segments).toHaveLength(2)
            expect(printWay(res.segments[0])).toEqual('82696507=7539895026,8498961197,8498961210,99836339')
            expect(printWay(res.segments[1])).toEqual('82696507=crossing,99887565,99887567')
        })


        test(('one way - no crossing'),()=>{
            useMapArea().setFilter(null)    // if we apply filters, we would not find a oneway in this area
            data = useMapArea().createMapData(defaultData);
            area = new MapArea(data, location,boundary );            

            const way = area.getWay('907331966')    // see https://www.openstreetmap.org/way/82696507   
            const startPos = {lat:26.69212640839961,lng:-80.03713846327933}
            const path = [8425475157,8425475158,8425475159,8425475160,8425475161,8425475162,6329797171]
            const paths:IncyclistWaySplit[] = prepareOptions(way.id, startPos, null, path)
            
            const res = area.buildSegmentInfo( way,paths)
            expect(res.segments).toHaveLength(1)
            expect(printWay(res.segments[0])).toEqual('907331966=crossing,8425475157,8425475158,8425475159,8425475160,8425475161,8425475162,6329797171')
        })



        

    });       
})