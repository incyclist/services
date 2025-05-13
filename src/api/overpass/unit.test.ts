import {OverpassApi} from '.';
import  axios from 'axios';
import fs from 'fs/promises'

describe ('OverpassClient Unit Test' ,() => {
    
    describe ( 'query', () => {

        let client;
        beforeEach( ()=> {
            client = new OverpassApi({url:'http://localhost'});
        })

        afterEach( ()=>{
            jest.resetAllMocks()
        })

        test ( 'positive case',async  () => {
            axios.post = jest.fn().mockResolvedValue({status:200,data:'success', statusText: 'OK', headers: {}, config: {}})               
            
            const result = await client.query("myquery");
            expect(axios.post).toHaveBeenCalledTimes(3)
            expect(result).toBe('success');
        } );

        test.skip ( 'real api - test to explore the data - manual test only',async  () => {

            console.log('-------------------- TEST CASE SHOULD NOT BE PART OF A SUITE RUN')            
            expect(process.env.CI).toBeUndefined()  
            // const query = "[out:json];way[highway](26.67639646112859,-80.04487372469582,26.69436287103533,-80.02476550851868);(._;>;);out geom;"
            // const fileName = './__tests__/data/overpass/default-location.json'

            const query = "[out:json];way[highway](26.68453889504663,-80.04377872640234,26.70250530495337,-80.02366907359766);(._;>;);out geom;"
            const fileName = './__tests__/data/overpass/default-3.json'

            const result = await client.query(query) as JSON       
            console.log(result)
            const str = JSON.stringify(result,null,2)
            fs.writeFile(fileName,str)            
            
        } );

        
        test ( 'server sends error',async  () => {
            axios.post = jest.fn().mockRejectedValue( new Error('error-text'));

            await expect( async ()=> {await client.query("myquery")}).rejects.toThrow('All promises were rejected')
            
        } );
        
        
    
    } )
    
})

