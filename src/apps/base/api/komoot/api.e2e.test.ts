import { AxiosFormPost } from '../../../../../__tests__/utils/formPost'
import {KomootApi} from './api'
import fs from 'fs/promises'
import path from 'path'

import dotenv from 'dotenv';
dotenv.config();

const username = process.env.KOMOOT_USER
const password = process.env.KOMOOT_PASS
const userid = process.env.KOMOOT_ID


describe('KommotApi',()=>{
    describe('login',()=>{
        // Don't execute test if no credentials were provided
        if (!username || !password) {
            console.log('skipping test login/success')
            return
        }
        
        let api;

        beforeEach( ()=>{
            api = new KomootApi()
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
        })
        

        test('success',async()=>{
            
            const res = await api.login(username,password,userid)
            console.log(res)
        })
    })

    describe('getTours', ()=>{


        const canRun = () => {
            // Don't execute test if no credentials were provided
            if (!username || !password || !userid) {
                console.log('skipping test login/success')
                return false;
            }
            return true
        }
        let api;

        beforeEach( ()=>{
            api = new KomootApi()
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
            api.username = username
            api.password = password
            api.userid = userid
        })

        test('print',async()=>{           
            if (!canRun()) 
                return
            const res = await api.getTours()
            console.log( res.map( a=> `${a.id} ${a.name} ${a.sport} ${a.distance } ${a.elevation_up} ${a.changed_at}` ) )
        })

        

        test('success',async()=>{           
            if (!canRun()) 
                return
            const res = await api.getTours()
            const str = JSON.stringify(res)
            const file = path.join(__dirname,'../../../../../__tests__/data/apps/komoot/tours.json')
            
            await fs.writeFile( file,str,{encoding:'utf-8'})          

        })
        test('with params and filters',async()=>{           
            if (!canRun()) 
                return
            const res = await api.getTours({type:'tour_planned'})

            const str = JSON.stringify(res)
            const file = path.join(__dirname,'../../../../../__tests__/data/apps/komoot/tour_planned.json')
            
            await fs.writeFile( file,str,{encoding:'utf-8'})          

        })
    
    })



    describe('getTourCoordinates', ()=>{


        const canRun = () => {
            // Don't execute test if no credentials were provided
            if (!username || !password || !userid) {
                console.log('skipping test login/success')
                return false;
            }
            return true
        }
        let api;

        beforeEach( ()=>{
            api = new KomootApi()
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
            api.username = username
            api.password = password
            api.userid = userid
        })

        test('success',async ()=>{
            const res = await api.getTourCoordinates(1868570044)
  
            const str = JSON.stringify(res)
            const file = path.join(__dirname,'../../../../../__tests__/data/apps/komoot/coordinates.json')
            
            await fs.writeFile( file,str,{encoding:'utf-8'})          
            
        })

    })
})