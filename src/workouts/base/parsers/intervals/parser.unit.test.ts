import { IntervalsJsonParser } from './parser';
import { FileInfo } from '../../../../api';
import { IntervalsWorkout } from './types';

describe('IntervalsJsonParser', () => {
  let parser: IntervalsJsonParser;
  const baseWorkout = {
    description: 'Test workout',
    duration: 600,
    ftp: 250,
    lthr: 180,
    max_hr: 200,
    sportSettings: {
      hr_zones: [117, 130, 135, 144, 148, 153, 170],
      power_zones: [55, 75, 90, 105, 120, 150, 999]
    },
    steps: []
  };

  beforeEach(() => {
    parser = new IntervalsJsonParser();
  });

  afterAll(() => {
    jest.clearAllMocks();
  });

    describe('import', () => {
        test('import a workout from file and data', async () => {
            const file: FileInfo = { name: 'workout.json', url: '', filename: 'workout.json', type: 'file', dir: '', ext: '.json', delimiter: '/' } as FileInfo;
            const workoutJson = {
                ...baseWorkout,
                steps: [{ duration: 60, intensity: 'active', power: { units: 'w', start: 100, end: 150 }, text: 'Step 11' }]
            };
            const parserWithMock = new IntervalsJsonParser();
        (parserWithMock as any).getLoader = jest.fn(() => ({ open: async () => ({ error: false, data: JSON.stringify(workoutJson) }) }));
            const result = await parserWithMock.import(file, JSON.stringify(workoutJson));
            expect(result.steps[0].power).toMatchObject({ type: 'watt', min: 100, max: 150 });
        });
    });

  describe('fromStr', () => {
    test('parse a workout with a single step (power in watts)', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', power: { units: 'w', start: 100, end: 150 }, text: 'Step 1' }]
      };
      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].power).toMatchObject({ type: 'watt', min: 100, max: 150 });
    });

    test('parse a workout with a step using %ftp', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', power: { units: '%ftp', start: 50, end: 60 }, text: 'Step 2' }]
      };
      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].power).toMatchObject({ type: 'pct of FTP', min: 50, max: 60 });
    });

    test('step using power_zone - with ftp, absolute values', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60,  power: { units: 'power_zone', start: 1, end: 2 }, text: 'Step 3', _power: {  value: 150, start: 100, end: 250 } }]
      };
      const result = parser.fromJSON(workoutJson, 'workout.json');
      expect(result.steps[0].power).toMatchObject({ type: 'pct of FTP', min: 40, max: 100 });
    });
    test('step using power_zone - with ftp, no absolute', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60,  power: { units: 'power_zone', start: 1, end: 2 }, text: 'Step 3' }]
      };
      const result = parser.fromJSON(workoutJson, 'workout.json');
      expect(result.steps[0].power).toMatchObject({ type: 'pct of FTP', min: 0, max: 75 });
    });
    test('step using power_zone - no ftp, no absolute', () => {
      const workoutJson:IntervalsWorkout = {
        ...baseWorkout,
        steps: [{ duration: 60,  power: { units: 'power_zone', start: 1, end: 2 }, text: 'Step 3' }]
      };
      delete workoutJson.ftp
      expect ( () => parser.fromJSON(workoutJson, 'workout.json')).toThrow();

    });
    test('step using power_zone - no ftp, absolute values', () => {
      const workoutJson:IntervalsWorkout = {
        ...baseWorkout,
        steps: [{ duration: 60,  power: { units: 'power_zone', value:2 }, text: 'Step 3', _power: {  value: 125, start: 100, end: 150 } }]
      };
      delete workoutJson.ftp    
      const result = parser.fromJSON(workoutJson, 'workout.json');
      expect(result.steps[0].power).toMatchObject({ type: 'watt', min: 100, max: 150 });
    });

    test('parse a workout with a step using %mmp', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', power: { units: '%mmp', start: 50, end: 60 }, _power: { units: 'w', start: 125, end: 150 }, text: 'Step 4' }]
      };
      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].power?.type).toBe('watt');
      expect(result.steps[0].power?.min).toBe(125);
      expect(result.steps[0].power?.max).toBe(150);
    });

    test('parse a workout with a step with cadence', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', cadence: { units: 'rpm', start: 80, end: 90 }, text: 'Step 5' }]
      };
      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0]).toMatchObject( {cadence: { min: 80, max: 90 }});

    });

    test('parse a workout with a step with hr in %hr - with absolute values', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', hr: { units: '%hr', start: 50, end: 60 }, _hr: { units: '%hr', start: 100, end: 120 }, text: 'Step 6' }]
      };
      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 100, max: 120 });
    });

    test('parse a workout with a step with hr in %hr - no absolute values', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', hr: { units: '%hr', start: 50, end: 60 }, text: 'Step 6' }]
      };
      workoutJson.max_hr = 180

      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 90, max: 108 });
    });

      test('parse a workout step with hr units "%lthr - with absolute values"', () => {
        const workoutJson = {
          ...baseWorkout,
          steps: [{ duration: 60, intensity: 'active', hr: { units: '%lthr', start: 50, end: 60 }, _hr: { units: '%lthr', start: 100, end: 120 }, text: 'Step lthr' }]
        };
        const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 100, max: 120 });
      });
      test('parse a workout step with hr units "%lthr - no absolute values"', () => {
        const workoutJson = {
          ...baseWorkout,
          steps: [{ duration: 60, intensity: 'active', hr: { units: '%lthr', start: 50, end: 60 }, text: 'Step lthr' }]
        };
        workoutJson.lthr = 150;
        const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 75, max: 90 });
      });

      test('parse a workout step with hr units "hr_zone, single zone, no absolute"', () => {
        const workoutJson = {
          ...baseWorkout,
          steps: [{ duration: 60, intensity: 'active', hr: { units: 'hr_zone', value:2.0 }, text: 'Step hr_zone' }]
        };
        workoutJson.sportSettings.hr_zones = [120,140,160];
        const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 121, max: 140 });
      });
      test('parse a workout step with hr units "hr_zone", multiple zones, no absolute', () => {
        const workoutJson = {
          ...baseWorkout,
          steps: [{ duration: 60, intensity: 'active', hr: { units: 'hr_zone', start:2.0,end:3.0 }, text: 'Step hr_zone' }]
        };
        workoutJson.sportSettings.hr_zones = [120,140,160];
        const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 121, max: 160 });
      });

      test('parse a workout step with hr units "hr_zone, single zone, with absolute"', () => {
        const workoutJson = {
          ...baseWorkout,
          steps: [{ duration: 60, intensity: 'active', hr: { units: 'hr_zone', value:2.0 },_hr: { start:130, end:150 },  text: 'Step hr_zone' }]
        };
        workoutJson.sportSettings.hr_zones = [120,140,160];
        const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 130, max: 150 });
      });
      test('parse a workout step with hr units "hr_zone", multiple zones, with absolute', () => {
        const workoutJson = {
          ...baseWorkout,
          steps: [{ duration: 60, intensity: 'active', hr: { units: 'hr_zone', start:2.0,end:3.0 },_hr: { start:130, end:170 }, text: 'Step hr_zone' }]
        };
        workoutJson.sportSettings.hr_zones = [120,140,160];
        const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].hrm).toEqual({ min: 130, max: 170 });
      });


    test('parse a workout with a ramp step', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', ramp: true, power: { units: 'w', start: 100, end: 150 }, text: 'Step 7' }]
      };
      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].steady).toBe(false);
    });

    test('parse a workout with a cooldown step', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'cooldown', cooldown: true, power: { units: 'w', start: 150, end: 100 }, text: 'Step 8' }]
      };
      const result = parser.fromStr(JSON.stringify(workoutJson), 'workout.json');
      expect(result.steps[0].cooldown).toBe(true);
    });

    test('throw error for step with no duration', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ intensity: 'active', power: { units: 'w', start: 100, end: 150 }, text: 'Step 9' }]
      };
      expect(() => parser.fromStr(JSON.stringify(workoutJson), 'workout.json')).toThrow();
    });
  });

  describe('fromJSON', () => {
    test('parse a workout from JSON object', () => {
      const workoutJson = {
        ...baseWorkout,
        steps: [{ duration: 60, intensity: 'active', power: { units: 'w', start: 100, end: 150 }, text: 'Step 10' }]
      };
  const result = parser.fromJSON(workoutJson as any, 'workout.json');
      expect(result.steps[0].power).toMatchObject({ type: 'watt', min: 100, max: 150 });
    });
  });


  describe('supportsExtension', () => {
    test('return true for json', () => {
      expect(parser.supportsExtension('json')).toBe(true);
    });
    test('return false for non-json', () => {
      expect(parser.supportsExtension('xml')).toBe(false);
    });
  });

  describe('supportsContent', () => {
    test('return true for valid intervals json', () => {
      const validJson = JSON.stringify({ type: 'intervals', steps: [] });
      expect(parser.supportsContent(validJson)).toBe(true);
    });
    test('return false for invalid content', () => {
      const invalidJson = JSON.stringify({ type: 'workout', steps: [] });
      expect(parser.supportsContent(invalidJson)).toBe(false);
    });
  });



  describe('getData', () => {
    let parser: IntervalsJsonParser;
    beforeEach(() => {
      parser = new IntervalsJsonParser();
    });

    test('return provided data string directly', async () => {
      const file: FileInfo = { name: 'workout.json', url: '', filename: 'workout.json', type: 'file', dir: '', ext: '.json', delimiter: '/' } as FileInfo;
      const data = '{"type":"intervals","steps":[]}';
      const result = await parser.getData(file, data);
      expect(result).toBe(data);
    });

    test('use loader to open file if data is not provided', async () => {
      const file: FileInfo = { name: 'workout.json', url: '', filename: 'workout.json', type: 'file', dir: '', ext: '.json', delimiter: '/' } as FileInfo;
      const loaderMock = { open: jest.fn(async () => ({ error: false, data: 'filedata' })) };
      (parser as any).getLoader = jest.fn(() => loaderMock);
      const result = await parser.getData(file);
      expect(result).toBe('filedata');
      expect(loaderMock.open).toHaveBeenCalledWith(file);
    });

    test('throw error if loader returns error', async () => {
      const file: FileInfo = { name: 'workout.json', url: '', filename: 'workout.json', type: 'file', dir: '', ext: '.json', delimiter: '/' } as FileInfo;
      const loaderMock = { open: jest.fn(async () => ({ error: true, data: '' })) };
      (parser as any).getLoader = jest.fn(() => loaderMock);
      await expect(parser.getData(file)).rejects.toThrow('Could not open file');
    });
  });

});
