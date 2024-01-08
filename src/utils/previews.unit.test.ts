import previewsData from '/mnt/c/temp/Incyclist/previews.json'
import fs from 'fs/promises'
import { parseXml } from '../routes/base/utils/xml'
import { KWTParser } from '../routes/base/parsers'
import { FileInfo } from '../api'
import path from 'path'

const XML_DIR = '/mnt/nas/data/videos/reallifevideo.de/XML'
//const PREVIEW_DIR = '/mnt/nas/data/videos/reallifevideo.de/Previews'

describe.skip( 'previewlist',()=>{

    test('generate list',async ()=>{
        
        const files = await fs.readdir(XML_DIR).then( res=> res.map(f=>path.join(XML_DIR,f)))
        console.log('FILES:',files)


        
        const previews = previewsData || {}
        const parser = new KWTParser()
        const errors: Array<{file:string,error:string,stack:string}> = []
    
        for (let i=0; i<files.length;i++) {
            const file = files[i]
            try {

                const xml = (await fs.readFile( file)).toString()

                try {
                    const json = await parseXml(xml)
                    json.expectScheme('kwt')



                    const preview = json.get('previewURL')
                    let id = json.get('id')
                    const name = json.get('name')

                    if (preview) {

                        const match = preview?.match(/rlv=([^&]*)&/)
                        if (match) {
                            const key = match[1]
                            const previewUrl = `https://www.reallifevideo.de/downloads/preview/${key}_mittel.jpg`
                            console.log('found ', id,file, previewUrl)      
                            
                            previews[id] = previewUrl
                            if (name) {
                                previews[name] = previewUrl
                            }
                            continue
                        }
                        else{
                            console.log('no match',preview)
                                    
                        }
    
                    }

                    
                    const url = json.get('url')?.de
                    console.log('not found',file, url )
                    if (url) {
                        const match = url?.match(/rlv=([^&]*)$/)
                        if (match) {
                            const key = match[1]
                            const previewUrl = `https://www.reallifevideo.de/downloads/preview/${key}_mittel.jpg`
                            console.log('found ', id,file, previewUrl)      
                            
                            previews[id] = previewUrl
                            if (name) {
                                previews[name] = previewUrl
                            }
                            continue
                        }
                        else{
                            console.log('no match',url)
                                    
                        }

                        return
                    }

                    if (!preview) {
                        console.log('not found',file )
                    }

                    const fileInfo = path.parse(file) as unknown as FileInfo
                    fileInfo.filename = file

                    const res = await parser.import(fileInfo, json)
                    //console.log(res.data.id, res.data.title)

                    id = res.data.id
                    if (!id || previews[id])                    
                        continue
                   
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const t = {...res.details} as any
                    delete t.points
                    delete t.video?.mappings

                    const match = res?.details?.previewUrl?.match(/rlv=([^&]*)&/)
                    console.log(match || res?.details?.previewUrl )
                    if (match) {
                        const key = match[1]
                        const previewUrl = `https://www.reallifevideo.de/downloads/preview/${key}_mittel.jpg`
                        console.log('found ', res.data.id,res.data.title, previewUrl)      
                        if (res.data.id)  
                            previews[res.data.id] = previewUrl
                        if (name) {
                            previews[name] = previewUrl
                        }

                    }
                    
                }
                catch (err){
                    console.log(err)                    
                    errors.push( { file, error:err.message, stack:err.stack})
                }
            }
            catch(err) {
                //console.log('not found', id, data[id].title)
                errors.push( { file, error:err.message, stack:err.stack})
                console.log(err)
            }

        }
    
        await fs.writeFile( '/mnt/c/temp/Incyclist/previews.json', JSON.stringify(previews,null,2))

        await fs.writeFile( '/mnt/c/temp/Incyclist/errors.json', JSON.stringify(errors,null,2))
    
    },1000000)



    test('parse all ',async ()=>{
        
        const files = await fs.readdir(XML_DIR).then( res=> res.map(f=>path.join(XML_DIR,f)))
        console.log('FILES:',files)
        
        const parser = new KWTParser()
        const errors: Array<{file:string,error:string,stack:string}> = []
    
        for (let i=0; i<files.length;i++) {
            const file = files[i]

            try {

                const xml = (await fs.readFile( file)).toString()

                try {
                    const json = await parseXml(xml)
                    const fileInfo = path.parse(file) as unknown as FileInfo
                    fileInfo.filename = file

                    await parser.import(fileInfo, json)
                    
                }
                catch (err){
                    console.log(err)                    
                    errors.push( { file, error:err.message, stack:err.stack})
                }
                //console.log('found ', id,data[id].title, info.url)
                //previews[id] = info.url

                //if (i==3)
                //    return
            }
            catch(err) {
                //console.log('not found', id, data[id].title)
                errors.push( { file, error:err.message, stack:err.stack})
                console.log(err)
            }



            //await sleep(3000)
        }

        await fs.writeFile( '/mnt/c/temp/Incyclist/errors.json', JSON.stringify(errors,null,2))
    
    },1000000)    

})



