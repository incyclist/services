import {OverpassApi} from '.';
import  axios from 'axios';


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

        test.skip ( 'real api - manual test only',async  () => {
            const query = "[out:json][timeout:25];way['addr:country'](around:20000,40.0748576503,23.9807375427);(._;>;);out tags;"
            
            const result = await client.query(query) as JSON       
            console.log(result)
            const str = JSON.stringify(result)
            expect(str).toContain('addr:country')
        } );

        
        test ( 'server sends error',async  () => {
            axios.post = jest.fn().mockRejectedValue( new Error('error-text'));

            await expect( async ()=> {await client.query("myquery")}).rejects.toThrow('All promises were rejected')
            
        } );
        
        
    
    } )
    
})

