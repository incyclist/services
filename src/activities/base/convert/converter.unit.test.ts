import { ActivityDetails } from "../model";
import { ActivityConverter } from "./converter";
import { RemoteFitConverter } from "./fit";
import { TcxConverter } from "./tcx";

// Mocking dependencies
jest.mock("./fit");
jest.mock("./tcx");

const activity: ActivityDetails = {
    type: 'IncyclistActivity', version: '1', id: 'test', title: 'test', logs: [], distance: 100, user: { weight: 80 },
    route: { hash: '1', name: '1' }, startTime: '', startPos: 0,
    time: 0,
    timeTotal: 0,
    timePause: 0,
    totalElevation: 0,
    realityFactor: 0
};

describe('ActivityConverter', () => {

    beforeEach( ()=>{
        RemoteFitConverter.prototype.convert = jest.fn().mockResolvedValue('FIT converted data')
        TcxConverter.prototype.convert=jest.fn().mockResolvedValue('TCX converted data');

    })

    afterEach(() => {
        jest.clearAllMocks()
        ActivityConverter.factory = undefined
    });

    test('FIT format', async () => {
        const result = await ActivityConverter.convert(activity, 'fit');

        expect(result).toEqual('FIT converted data');
    });

    test('TCX format', async () => {
        const result = await ActivityConverter.convert(activity, 'tcx');

        expect(result).toEqual('TCX converted data');
    });

    test('any other format', async () => {
        await expect( async()=>{await ActivityConverter.convert(activity, 'aaa')}).rejects.toThrow('unknown format: aaa')
    });

    test('converter throws error', async () => {
        RemoteFitConverter.prototype.convert = jest.fn().mockRejectedValue(new Error('XXX'))

        await expect( async()=>{await ActivityConverter.convert(activity, 'fit')}).rejects.toThrow('XXX')
    });


});
