import VeloHeroApi from "./api";
import dotenv from 'dotenv';
import { AxiosFormPost } from "../../../../../__tests__/utils/formPost";

dotenv.config();

const username = process.env.VELOHERO_USER
const password = process.env.VELOHERO_PASS
const id = process.env.VELOHERO_ID

describe ('VeloHero',()=> {

    describe('login',()=>{

        let api;

        beforeEach( ()=>{
            api = new VeloHeroApi()
        })

        test( 'success',async ()=>{
            // Don't execute test if no credentials were provided
            if (!username || !password) {
                console.log('skipping test login/success')
                return
            }
            
            const res = await api.login(username,password)
            
            expect(res.username).toEqual(username)
            expect(res.id).toEqual(id)
            expect(res.isPro).toBe(true)
            expect(res.session).toBeDefined()
        })


        test( 'invalid credentials',async ()=>{
            // Don't execute test if no credentials were provided
            if (!username || !password) {
                console.log('skipping test login/success')
                return
            }
            
            await expect( async () => {await api.login(username,'')})
                .rejects
                .toThrow('invalid credentials')
           
        })


    })

    describe( 'upload',()=>{
        let api;

        beforeEach( ()=>{
            api = new VeloHeroApi()
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
        })

        afterEach( ()=>{

        })

        test('valid file',async ()=>{
            const res = await api.upload('__tests__/data/activities/test.tcx',{username,password})
            expect(res).toBe(true)
        })

    })
})