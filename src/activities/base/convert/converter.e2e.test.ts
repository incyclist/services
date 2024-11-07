import { initUserSettings} from "../../../settings";
import { MockSettingsBinding } from "../../../settings/user/bindings/mock.test.util";
import { ActivityConverter } from "./converter";
import fs from 'fs'
import path from 'path'


// USAGE:
// 1. change FOLDER and FILENAME, to match the activity that you want to use for the test
// 2. run test(s)
// 3. manually verify the files that were generated in the FOLDER folder

const FOLDER = '/tmp'
const FILENAME = 'activity.json'
const settings = {

}

describe('ActivityConverter', () => {

    let activity
    beforeEach( async ()=>{

        await initUserSettings( new MockSettingsBinding(settings) )
        const data = fs.readFileSync(path.join(FOLDER,FILENAME),{encoding:'utf-8'})
        activity = JSON.parse(data)

    })

    afterEach(() => {
    });

    test('FIT format', async () => {
        const result = await ActivityConverter.convert(activity, 'fit') as unknown as  ArrayBuffer;
        const fileName = FILENAME.replace('.json', '.fit')

        
        fs.writeFileSync( path.join(FOLDER,fileName), Buffer.from(result),{encoding:"binary"})
    });

    test('TCX format', async () => {
        const result = await ActivityConverter.convert(activity, 'tcx');
        const fileName = FILENAME.replace('.json', '.tcx')

        fs.writeFileSync( path.join(FOLDER,fileName), result as string,{encoding:"utf-8"})
    });



});
