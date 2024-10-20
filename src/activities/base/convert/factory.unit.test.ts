/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActivityDetails } from '../model';
import { ActivityConverterFactory } from './factory';
import { IActivityConverter } from './types'; // Assuming types are defined in a separate file

// Mock converter implementing IActivityConverter interface
class MockConverter1 implements IActivityConverter {
    async convert(activity: ActivityDetails): Promise<any> {
        return 'Converted by MockConverter1';
    }
}

// Another mock converter implementing IActivityConverter interface
class MockConverter2 implements IActivityConverter {
    async convert(activity: ActivityDetails): Promise<any> {
        return 'Converted by MockConverter2';
    }
}

describe('ActivityConverterFactory', () => {
    let factory: ActivityConverterFactory;
    let f
    const activity: ActivityDetails = {
        type: 'IncyclistActivity', version: '1', id: 'test', title: 'test', logs: [], distance: 100, user: { weight: 80 },
        route: { hash: '1', name: '1' }, startTime: '', startPos: 0,
        time: 0,
        timeTotal: 0,
        timePause: 0,
        totalElevation: 0,
        realityFactor: 0
    };

    beforeEach(() => {
        f = factory = new ActivityConverterFactory();

        // Create instances of mock converters
        const mockConverter1 = new MockConverter1();
        const mockConverter2 = new MockConverter2();

        // Add mock converters to the factory
        factory.add('tcx', mockConverter1);
        factory.add('fit', mockConverter2);
        
    });

    afterEach( ()=> {
        f.reset()
    })

    test('should add converters and convert activities to target format', async () => {

        // Convert activity to mockFormat1
        let result = await factory.convert(activity, 'tcx');
        expect(result).toBe('Converted by MockConverter1');

        result = await factory.convert(activity, 'TCX');
        expect(result).toBe('Converted by MockConverter1');

        // Convert activity to fit
        result = await factory.convert(activity, 'fit');
        expect(result).toBe('Converted by MockConverter2');
    });

    test('should throw error for unknown target format', async () => {
        // Attempt to convert activity to an unknown format
        await expect(factory.convert(activity, 'unknownFormat')).rejects.toThrow('unknown format: unknownFormat');
    });

    it('should throw error if activity or target format is not specified', async () => {
        // Attempt to convert without specifying activity or target format
        let undefinedActivity
        let undefinedFormat
        await expect(factory.convert(undefinedActivity, 'tcx')).rejects.toThrow('illegal use: activity and format need to be specified');
        await expect(factory.convert({} as ActivityDetails, undefinedFormat)).rejects.toThrow('illegal use: activity and format need to be specified');
    });
});
