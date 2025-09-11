import {Vector}  from './vector'

describe ( 'constructor', () => {

    test ( 'coordinates', () => {
        let res = new Vector( {coordinates:{x:1,y:2} })
        expect ( res.x ).toBe(1);
        expect ( res.y ).toBe(2);
    } );
    test ( 'vector', () => {
        let v1 = new Vector( {coordinates:{x:1,y:2} });
        let res = new Vector( v1 )
        expect ( res.x ).toBe(1);
        expect ( res.y ).toBe(2);
        expect ( res===v1).toBe(false);
    } );

    test ( 'coordinates as array', () => {
        let res = new Vector( [1,2] )
        expect ( res.x ).toBe(1);
        expect ( res.y ).toBe(2);
    } );
    test ( 'path', () => {
        let res = new Vector( {path:{bearing:90,distance:2} })
        expect ( res.x ).toBe(2);
        expect ( res.y ).toBeCloseTo(0);
    } );

    test ( 'incorrect array', () => {
        expect(() => {
             new Vector( [1])
        }).toThrow("incorrect value of: props");
    } );
    test ( 'incorrect coordinate', () => {
        expect(() => {
            new Vector({coordinates:{a:1, b:1}} )
        }).toThrow("incorrect value of: props.coordinates");
    } );
    test ( 'incorrect path', () => {
        expect(() => {
            new Vector({path:{}} )
        }).toThrow("incorrect value of: props.path");
    } );    
    
});

describe ( 'equals', () => {
    test ( 'positive  - argument is array', () => {
        let v = new Vector( [1,2] )
        let res = v.equals( [1,2] )
        expect ( res).toBe(true);
    } );
    test ( 'positive - argument is vector', () => {
        let v = new Vector( [1,2] )
        let v2 = new Vector( new Vector( {coordinates:{x:1,y:2}} ) )
        let res = v.equals( v2 )
        expect ( res ).toBe(true);
    } );
    test ( 'negative  - argument is array', () => {
        let v = new Vector( [1,2] )
        let res = v.equals( [1,1] )
        expect ( res).toBe(false);
    } );
    test ( 'negative - argument is vector', () => {
        let v = new Vector( [1,2] )
        let v2 = new Vector( [2,3] )
        let res = v.equals( v2 )
        expect ( res ).toBe(false);
    } );
    test ( 'negative - invalid argument', () => {
        let v = new Vector( [1,2] )
        let res = v.equals( 10 )
        expect ( res ).toBe(false);
    } );

})

describe ( 'eq', () => {
    test ( 'non-static', () => {
        let v = new Vector( [1,2] )
        let res = v.eq( [1,2] )
        expect ( res).toBe(true);
    } );
    test ( 'static: 1st argument is array', () => {
        let res = Vector.eq( [1,2],[1,2] )
        expect ( res).toBe(true);
    } );
    test ( 'static: 1st argument is vector', () => {
        let v = new Vector( [1,2] )
        let res = Vector.eq( v, [1,2] )
        expect ( res).toBe(true);
    } );
    test ( 'static: 1st argument undefined', () => {
        let res = Vector.eq( undefined, [1,2] )
        expect ( res).toBe(false);
    } );
    test ( 'static: 1st argument is any other type', () => {
        expect(() => {
            Vector.eq( '10', [1,2] )
        }).toThrow("invalid argument");
    } );


})

describe ( 'isParallel', () => {
    test ( 'non-static: vector is equal', () => {
        let v = new Vector( [1,2] )
        let res = v.isParallel( [1,2] )
        expect ( res).toBe(true);
    } );
    test ( 'non-static: vector is parallel (argument is vector)', () => {
        let v = new Vector( [1,2] )
        let res = v.isParallel( new Vector([2,4]) )
        expect ( res).toBe(true);
    } );
    test ( 'non-static: vector is parallel (argument is array)', () => {
        let v = new Vector( [1,2] )
        let res = v.isParallel( [2,4] )
        expect ( res).toBe(true);
    } );
    test ( 'non-static: vector is not parallel', () => {
        let v = new Vector( [1,2] )
        let res = v.isParallel( [2,3] )
        expect ( res).toBe(false);
    } );
    test ( 'non-static: argument is not vector or array', () => {
        let v = new Vector( [1,2] )
        let res = v.isParallel( "2,4" )
        expect ( res).toBe(false);            
    } );
    test ( 'non-static: vector is parallel (argument is partial array)', () => {
        let v = new Vector( [1,2] )
        let res = v.isParallel( [2] )
        expect ( res).toBe(false);
    } );

    test ( 'static: 1st argument is array', () => {
        let res = Vector.isParallel( [1,2],[2,4] )
        expect ( res).toBe(true);
    } );
    test ( 'static: 1st argument is vector', () => {
        let v = new Vector( [1,2] )
        let res = Vector.isParallel( v, [3,6] )
        expect ( res).toBe(true);
    } );
    test ( 'static: 1st argument undefined', () => {
        let res = Vector.isParallel( undefined, [1,2] )
        expect ( res).toBe(false);
    } );
    test ( 'static: 1st argument is any other type', () => {
        expect(() => {
            Vector.isParallel( '10', [1,2] )
        }).toThrow("invalid argument");
    } );

    test ( 'static: x is 0', () => {
        let res = Vector.isParallel( [0,2],[0,4] )
        expect ( res).toBe(true);
        res = Vector.isParallel( [0,2],new Vector([0,6]) )
        expect ( res).toBe(true);
    } );
    test ( 'static: y is 0', () => {
        let res = Vector.isParallel( [2,0],[4,0] )
        expect ( res).toBe(true);
        res = Vector.isParallel( [2,0],new Vector([6,0]) )
        expect ( res).toBe(true);
    } );



})

describe ( 'isSameDirection', () => {
    test ( 'non-static: vector is in same direction', () => {
        let v = new Vector( [1,2] )
        let res = v.isSameDirection( [2,4] )
        expect ( res).toBe(true);
        res = v.isSameDirection( new Vector([2,4]) )
        expect ( res).toBe(true);
    } );
    test ( 'non-static: vector is not in same direction', () => {
        let v = new Vector( [1,2] )
        let res = v.isSameDirection( [-2,-4] )
        expect ( res).toBe(false);
    } );
    test ( 'non-static: vector is not parallel', () => {
        let v = new Vector( [1,2] )
        let res = v.isSameDirection( [2,3] )
        expect ( res).toBe(false);
    } );

})


describe ( 'add', () => {
    test ( 'argument is array', () => {
        let v = new Vector( [1,2] )
        v.add( [1,1] )
        expect ( v.x ).toBe(2);
        expect ( v.y ).toBe(3);
    } );
    test ( 'argument is empty array', () => {
        let v = new Vector( [1,2] )
        v.add( [] )
        expect ( v.x ).toBe(1);
        expect ( v.y ).toBe(2);
    } );
    test ( 'argument is array with onyl one element', () => {
        let v = new Vector( [1,2] )
        v.add( [1] )
        expect ( v.x ).toBe(2);
        expect ( v.y ).toBe(2);
    } );
    test ( 'argument is vector', () => {
        let v = new Vector( [1,2] )
        let v2 = new Vector( [2,3] )
        v.add( v2 )
        expect ( v.x ).toBe(3);
        expect ( v.y ).toBe(5);
    } );
    test ( 'any other argument', () => {
        expect(() => {
            let v = new Vector( [1,2] );
            v.add( 10 );
        }).toThrow("invalid argument");
    } );
    test ( 'static ', () => {
        let v1 = new Vector( [1,2] )
        let v2 = new Vector( [2,3] )
        let v = Vector.add( v1,v2 )
        expect ( v.x ).toBe(3);expect ( v.y ).toBe(5);
        expect ( v1.x ).toBe(1);expect ( v1.y ).toBe(2);
        expect ( v2.x ).toBe(2);expect ( v2.y ).toBe(3);
    } );

})


describe ( 'min', () => {
    test ( 'argument is array', () => {
        let v = new Vector( [1,2] )
        v.min( [1,1] )
        expect ( v.x ).toBe(0);
        expect ( v.y ).toBe(1);
    } );
    test ( 'argument is empty array', () => {
        let v = new Vector( [1,2] )
        v.min( [] )
        expect ( v.x ).toBe(1);
        expect ( v.y ).toBe(2);
    } );
    test ( 'argument is array with onyl one element', () => {
        let v = new Vector( [1,2] )
        v.min( [1] )
        expect ( v.x ).toBe(0);
        expect ( v.y ).toBe(2);
    } );
    test ( 'argument is vector', () => {
        let v = new Vector( [3,5] )
        let v2 = new Vector( [2,3] )
        v.min( v2 )
        expect ( v.x ).toBe(1);
        expect ( v.y ).toBe(2);
    } );
    test ( 'any other argument', () => {
        expect(() => {
            let v = new Vector( [1,2] );
            v.min( 10 );
        }).toThrow("invalid argument");
    } );
    test ( 'static ', () => {
        let v1 = new Vector( [2,3] )
        let v2 = new Vector( [1,2] )
        let v = Vector.min( v1,v2 )
        expect ( v.x ).toBe(1);expect ( v.y ).toBe(1);
        expect ( v1.x ).toBe(2);expect ( v1.y ).toBe(3);
        expect ( v2.x ).toBe(1);expect ( v2.y ).toBe(2);
    } );

})

describe ( 'multiply', () => {
    test ( 'argument is number', () => {
        let v = new Vector( [1,2] )
        v.multiply( 5 )
        expect ( v.x ).toBe(5);
        expect ( v.y ).toBe(10);
    } );
    test ( 'argument is array', () => {
        let v = new Vector( [1,2] )
        let res = v.multiply( [2,3] )
        expect ( res ).toBe(8);
    } );
    test ( 'argument is empty array', () => {
        let v = new Vector( [1,2] )
        let res = v.multiply( [] )
        expect ( res ).toBe(0);
    } );
    test ( 'argument is array with onyl one element', () => {
        let v = new Vector( [2,3] )
        v.add( [] )
        let res = v.multiply( [2] )
        expect ( res ).toBe(4);
    } );
    test ( 'argument is vector', () => {
        let v = new Vector( [1,2] )
        let v2 = new Vector( [2,3] )
        let res = v.multiply( v2 )
        expect ( res).toBe(8);
    } );
    test ( 'any other argument', () => {
        expect(() => {
            let v = new Vector( [1,2] );
            v.multiply( 'Test' );
        }).toThrow("invalid argument");
    } );
    
    test ( 'static: 1st argument is Number', () => {
        let v1 = new Vector( [1,2] )
        let v = Vector.multiply( 10,v1 )
        expect ( v.x ).toBe(10);expect ( v.y ).toBe(20);
        expect ( v1.x ).toBe(1);expect ( v1.y ).toBe(2);
    } );
    test ( 'static: 1st argument is Array', () => {
        let v = new Vector( [2,3] )
        let res = Vector.multiply( [1,3],v )
        expect ( res ).toBe(11); // 2*1+3*3
    } );
    test ( 'static: 1st argument is Vector', () => {
        let v1 = new Vector( [10,2] )
        let v2 = new Vector( [2,3] )
        let res = Vector.multiply( v1,v2 )
        expect ( res ).toBe(26); // 10*2+2*3
    } );
    test ( 'static: 1st argument is incorrect type', () => {
        expect(() => {
            Vector.multiply( 'Test',[1,2] );
        }).toThrow("invalid argument");
    } );
    test ( 'static: 1st argument is NUmber and 2nd argument is incorrect type', () => {
        expect(() => {
            Vector.multiply( 10,'Test' );
        }).toThrow("invalid argument");
    } );


})

describe ( 'len', () => {
    test ( 'positive', () => {
        let v = new Vector( [3,4] )
        let res = v.len( );
        expect ( res ).toBeCloseTo(5);
        
    } );

})

describe ( 'angle', () => {
    test ( 'positive', () => {
        let v = new Vector( [4,4] )
        let res = v.angle( );
        expect ( res ).toBeCloseTo(45);
        
    } );
    test ( 'positive', () => {
        let v = new Vector( [0,0] )
        let res = v.angle( );
        expect ( res ).toBeUndefined();
        
    } );

})

describe ( 'isVector', () => {
    test ( 'positive', () => {
        let v = new Vector( [3,4] )
        let res = Vector.isVector(v);
        expect ( res ).toBe(true);
        
    } );
    test ( 'array', () => {
        let res = Vector.isVector([3,4]);
        expect ( res ).toBe(false);
        
    } );
    test ( 'Number', () => {
        let res = Vector.isVector(10);
        expect ( res ).toBe(false);        
    } );
    test ( 'String', () => {
        let res = Vector.isVector('10');
        expect ( res ).toBe(false);        
    } );
    test ( 'any json', () => {
        let res = Vector.isVector( { a:10, b:20} );
        expect ( res ).toBe(false);        
    } );
    test ( 'json with x and y', () => {
        let res = Vector.isVector( { x:10, y:20} );
        expect ( res ).toBe(false);        
    } );

})


