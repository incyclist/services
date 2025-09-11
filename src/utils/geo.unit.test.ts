import {crossing}  from './geo'
import {Vector} from './vector';

function getVectors(A,B,C,D) {
    let AB = Vector.min(B,A);
    let CD = Vector.min(D,C);
    let AC = Vector.min(C,A);
    return {AB,CD,AC};

}

describe ( 'crossing', () => {
    test ( 'lines are overlapping', () => {
        let {AB,CD,AC} = getVectors([0,0],[3,4],[3,4],[6,8])
        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 3);
        expect ( res.y ).toBe( 4);
    } );

    test ( 'CD ist starting somewhere in the middle of AB', () => {
        let {AB,CD,AC} = getVectors([0,0],[4,0],[2,0],[6,0])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 2);
        expect ( res.y ).toBe( 0);
    } );

    test ( 'lines are parallel', () => {
        let {AB,CD,AC} = getVectors([0,0],[3,4],[1,1],[4,5])

        let res = crossing( AB,CD,AC);
        expect ( res ).toBeUndefined( );
    } );


    test ( 'lines are parallel, different  direction C is between, D is between ', () => {
        let {AB,CD,AC} = getVectors([0,0],[4,0],[2,0],[1,0])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 1);
        expect ( res.y ).toBe( 0);
    } );

    test ( 'lines are parallel, different direction, D is between, C is before', () => {
        let {AB,CD,AC} = getVectors([0,0],[4,0],[2,0],[-1,0])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 0);
        expect ( res.y ).toBe( 0);
    } );

    test ( 'lines are parallel, different direction, D and C are after', () => {
        let {AB,CD,AC} = getVectors([0,0],[4,0],[8,0],[6,0])

        let res = crossing( AB,CD,AC);
        expect ( res ).toBeUndefined()
    } );


    test ( 'lines are parallel , but not overlapping (before)', () => {
        let {AB,CD,AC} = getVectors([0,0],[4,0],[-2,0],[-1,0])

        let res = crossing( AB,CD,AC);
        expect ( res).toBeUndefined();
        
    } );

    test ( 'lines are parallel , but not overlapping (after)', () => {
        let {AB,CD,AC} = getVectors([0,0],[4,0],[6,0],[8,0])

        let res = crossing( AB,CD,AC);
        expect ( res).toBeUndefined();
        
    } );

    test ( 'lines are crossing  -- AB.y=0 ', () => {
        let {AB,CD,AC} = getVectors([0,0],[4,0],[2,1],[2,-4])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 2);
        expect ( res.y ).toBe( 0);
    } );

    test ( 'lines are crossing -- AB.x==0', () => {
        let {AB,CD,AC} = getVectors([0,0],[0,4],[1,2],[4,2])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 0);
        expect ( res.y ).toBe( 2);
    } );

    test ( 'lines are crossing  -- CD.y=0 ', () => {
        let {AB,CD,AC} = getVectors([0,0],[2,2],[0,1],[4,1])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 1);
        expect ( res.y ).toBe( 1);
    } );

    test ( 'lines are crossing -- CD.x==0', () => {
        let {AB,CD,AC} = getVectors([0,0],[2,2],[4,2],[4,0])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 4);
        expect ( res.y ).toBe( 4);
    } );

    test ( 'lines are crossing in 90° angle ', () => {
        let {AB,CD,AC} = getVectors([0,0],[2,2],[0,2],[2,0])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 1);
        expect ( res.y ).toBe( 1);
    } );

    
    test ( 'Invalid Parameter AB', () => {
        expect(() => {
            crossing( "test", [0,0],[1,1] );
        }).toThrow("AB is not a vector");
    } );
    test ( 'Invalid Parameter CD', () => {
        expect(() => {
            crossing( [0,0],"test", [1,1] );
        }).toThrow("CD is not a vector");
    } );
    test ( 'Invalid Parameter AC', () => {
        expect(() => {
            crossing(  [0,0],[1,1],"test" );
        }).toThrow("AC is not a vector");
    } );

    
    test( 'A is not [0,0]', ()=>  {
        let {AB,CD,AC} = getVectors([1,0],[4,0],[2,1],[2,0.1])

        let res = crossing( AB,CD,AC);
        expect ( res.x ).toBe( 1); 
        expect ( res.y ).toBe( 0);

    } );

    


})
