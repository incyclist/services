import { loadFile } from '../../__tests__/utils/loadFile';
import {parseXml} from './xml'

describe ('XmlJSON',()=>{



    

    test('detectScheme',async ()=>{
        const xml = await loadFile('utf-8','./__tests__/data/rlv/DE_Schweighofen.xml') as string
        const xmlJson = await parseXml(xml)

        const scheme = xmlJson.detectScheme()
        expect(scheme).toBe('kwt')
      
    })
})