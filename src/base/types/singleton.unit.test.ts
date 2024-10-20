import {Singleton} from './singleton'


describe ('Singleton',()=>{

    test('multiple constructor calls' ,()=>{

        @Singleton
        class A {
            public value:number;
        }

        const a = new A()
        a.value = 10;

        const b = new A()
        expect(b.value).toBe(10)

        b.value=100
        expect(a.value).toBe(100)
        
        expect(a).toBe(b)

    })


    test('multiple classes' ,()=>{

        @Singleton
        class A {
            public value:number;
        }
        @Singleton
        class B {
            public value:number;
        }

        const a = new A()
        a.value = 10;

        const b = new B()
        expect(b.value).toBeUndefined()

    })

    test('derived' ,()=>{

        @Singleton
        class A {
            public value:number;
        }
        
        class B extends A{
            public value1:number = 12
        }


        const a = new A()
        a.value = 10;

        const b = new B()
        expect(b.value).toBe(10)
        expect(b.value1).toBe(12)

    })

    test('reset',()=>{

        @Singleton
        class A {
            public value:number = Math.random();
        }

        const a = new A()
        const aNum = a.value;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a as any).reset()

        const b = new A()
        const bNum = b.value;

        expect(aNum).not.toBe(bNum)

        


    })


})