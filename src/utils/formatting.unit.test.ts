import { formatDateTime, formatNumber, formatTime, pad, trimTrailingChars } from "./formatting"


describe('formatting',()=>{

    describe('formatDateTime', () => {
        test('default format string', () => {
            const date = new Date('2024-02-29T12:34:56');
            expect(formatDateTime(date)).toBe('20240229123456');
        });
    
        test('with specified format string', () => {
            const date = new Date('2024-02-29T12:34:56');
            expect(formatDateTime(date, '%Y-%m-%d %H:%M:%S')).toBe('2024-02-29 12:34:56');
            expect(formatDateTime(date, '%Y/%m/%d %H:%M:%S')).toBe('2024/02/29 12:34:56');
            expect(formatDateTime(date, '%Y-%m-%d %H:%M:%S')).toBe('2024-02-29 12:34:56');
        });
    
        test('with UTC methods if utc is true', () => {
            const date = new Date('2024-02-29T12:34:56Z');
            
            expect(formatDateTime(date, '%Y-%m-%d %H:%M:%S', true)).toBe('2024-02-29 12:34:56');

            
        });
    
        test('date is invalid', () => {
            let invalidDate 
            expect(formatDateTime(invalidDate)).toBe(undefined);
        });        
    });

    describe('formatTime', () => {
        it('should format time correctly without cutting missing leading hours', () => {
            expect(formatTime(3661, false)).toBe('1:01:01');
            expect(formatTime(65, false)).toBe('0:01:05');
            expect(formatTime(0, false)).toBe('0:00:00');
            expect(formatTime(7200, false)).toBe('2:00:00');
            expect(formatTime(36000, false)).toBe('10:00:00');
        });
    
        it('should format time correctly with cutting missing leading hours', () => {
            expect(formatTime(3661, true)).toBe('1:01:01');
            expect(formatTime(65, true)).toBe('01:05');
            expect(formatTime(0, true)).toBe('00:00');
            expect(formatTime(7200, true)).toBe('2:00:00');
            expect(formatTime(36000, true)).toBe('10:00:00');
        });
    
        it('should return undefined if seconds is undefined or null', () => {
            // eslint-disable-next-line prefer-const
            let x            
            expect(formatTime(x, false)).toBe(undefined);

            x = null
            expect(formatTime(x, false)).toBe(undefined);
        });
    });

    describe('formatNumber', () => {
        it('maxDigits and  maxLength ', () => {
            expect(formatNumber(10.22, 2,4)).toBe('10.22');
            expect(formatNumber(100.22, 2,4)).toBe('100.2');
            expect(formatNumber(1000.22, 2,4)).toBe('1000');
            expect(formatNumber(0.123456, 6, 5)).toBe('0.1235');
        });

        it('only maxDigits', () => {
            expect(formatNumber(3.14159, 2)).toBe('3.14');
            expect(formatNumber(12345.6789, 3)).toBe('12345.679');
            expect(formatNumber(0.123456, 4)).toBe('0.1235');
            expect(formatNumber(9876.54321, 0)).toBe('9877');
        });        
    })

    describe('pad',()=>{
        test('padding required',()=>{
            let res = pad(0.1,2)
            expect(res).toBe('00.1')
            res = pad(0,3)
            expect(res).toBe('000')
            res = pad(10,3)
            expect(res).toBe('010')
        })
        test('no padding required',()=>{
            let res = pad(10.1,2)
            expect(res).toBe('10.1')
            res = pad(100.1,2)
            expect(res).toBe('100.1')

        })

        test('mo length provided',()=>{
            let res = pad(1)
            expect(res).toBe('01')
            res = pad(100)
            expect(res).toBe('100')

        })

    })

    describe('trimTrailingChars',()=>{
        test('url with parameters',()=>{
            expect( trimTrailingChars('http://test/?a=1','/')).toBe('http://test/?a=1')
            expect( trimTrailingChars('http://test/1/?a=1','/')).toBe('http://test/1/?a=1')
        })
        test('url without parameters',()=>{

            expect( trimTrailingChars('http://test/','/')).toBe('http://test')
            expect( trimTrailingChars('http://test/1/','/')).toBe('http://test/1')
            expect( trimTrailingChars('http://test/1','/')).toBe('http://test/1')
            expect( trimTrailingChars('http://test//','/')).toBe('http://test')
        })

    })
})