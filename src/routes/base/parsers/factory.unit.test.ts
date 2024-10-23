import {ParserFactory} from './factory'
describe ('ParserFactory',()=> {

    describe( 'add',()=>{
        let p
        let parsers:ParserFactory

        beforeEach( ()=>{
            p = parsers = ParserFactory.getInstance()
        })

        afterEach( ()=>{
            p?.reset()
        })

        test('add multiple',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn(), supportsContent:jest.fn(), getData:jest.fn()}
            const p2 = { import:jest.fn(), supportsExtension:jest.fn(), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            parsers.add(p2)
            expect(p.parsers).toHaveLength(2)

        })

        test('add same twice',()=>{
            let parsers:ParserFactory
            p = parsers = ParserFactory.getInstance()
            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn(), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            parsers.add(p1)
            expect(p.parsers).toHaveLength(2)
        })


    })

    describe( 'supportsExtension',()=>{
        let p
        let parsers:ParserFactory

        beforeEach( ()=>{
            p = parsers = ParserFactory.getInstance()
        })

        afterEach( ()=>{
            p?.reset()
        })

        test('one parser, suppports extension',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            
            const res = parsers.suppertsExtension('test')
            expect(res).toEqual([p1])
        })
        test('multiple parsers, some suppport extension',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn(), getData:jest.fn()}
            const p2 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'|| e==='B'), supportsContent:jest.fn(), getData:jest.fn()}
            const p3 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='A'), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            parsers.add(p2)
            parsers.add(p3)
            
            const res = parsers.suppertsExtension('test')
            expect(res).toEqual([p1,p2])

            expect(parsers.suppertsExtension('B')).toEqual([p2])
            expect(parsers.suppertsExtension('A')).toEqual([p3])
        })
        test('multiple parsers, none suppports extension',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn(), getData:jest.fn()}
            const p2 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'|| e==='B'), supportsContent:jest.fn(), getData:jest.fn()}
            const p3 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='A'), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            parsers.add(p2)
            parsers.add(p3)
            

            expect( ()=>{parsers.suppertsExtension('XX')}).toThrow('invalid file format XX')
        })


    })

    describe( 'findMatching',()=>{
        let p
        let parsers:ParserFactory

        beforeEach( ()=>{
            p = parsers = ParserFactory.getInstance()
        })

        afterEach( ()=>{
            p?.reset()
        })


        test('one parser, no data',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            
            const res = parsers.findMatching('test')
            expect(res).toEqual(p1)
        })
        test('one parser, data not matching',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn().mockReturnValue(false), getData:jest.fn()}
            parsers.add(p1)
            
            expect( ()=>{
                parsers.findMatching('test',{x:1,y:2})
            }).toThrow('invalid file format test')
        })

        test('one parser, matching data',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn().mockReturnValue(true), getData:jest.fn()}
            parsers.add(p1)
            
            const res = parsers.findMatching('test',{x:1, y:2})
            expect(res).toEqual(p1)
        })

        test('multiple parsers, some suppport extension, no data',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn(), getData:jest.fn()}
            const p2 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'|| e==='B'), supportsContent:jest.fn(), getData:jest.fn()}
            const p3 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='A'), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            parsers.add(p2)
            parsers.add(p3)
            
            const res = parsers.findMatching('test')
            expect(res).toEqual(p1)

        })
        test('multiple parsers, none suppports extension',()=>{            
            const p1 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'), supportsContent:jest.fn(), getData:jest.fn()}
            const p2 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='test'|| e==='B'), supportsContent:jest.fn(), getData:jest.fn()}
            const p3 = { import:jest.fn(), supportsExtension:jest.fn( (e)=> e==='A'), supportsContent:jest.fn(), getData:jest.fn()}
            parsers.add(p1)
            parsers.add(p2)
            parsers.add(p3)
            

            expect( ()=>{parsers.findMatching('XX'),{}}).toThrow('invalid file format XX')
        })


    })

})