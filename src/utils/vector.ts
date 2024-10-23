import { sin, cos,abs,asin } from "./math";

const CLASS_VECTOR = 'vector';

export class Vector {

    protected _class: string
    protected _x:number
    protected _y:number

    constructor(props) {
        if (props===undefined) {
            throw new Error("missing mandatory argument: props")
        }
        if (Array.isArray(props)) {
            if (props.length<2) 
                throw new Error("incorrect value of: props")
            this._x =  props[0];
            this._y = props[1];

        }
        if (Vector.isVector(props)) {
            this._x = props.x;
            this._y = props.y
        }
        if (props.coordinates) {
            if (props.coordinates.x===undefined || props.coordinates.y===undefined) 
                throw new Error("incorrect value of: props.coordinates")
            this._x =  props.coordinates.x;
            this._y = props.coordinates.y;
        }
        if (props.path ) {
            if (props.path.bearing===undefined || props.path.distance===undefined) 
                throw new Error("incorrect value of: props.path")
            let d = props.path.distance;
            let alpha = props.path.bearing;
            this._x = d*sin(alpha);
            this._y = d*cos(alpha);
        }
        this._class = CLASS_VECTOR;
    }

    get x() {
        return this._x
    }

    get y() {
        return this._y
    }

    eq(v) {
        return this.equals(v);
    }

    equals(v) {
        if ( !Vector.isVector(v) && !Array.isArray(v) )
            return false;
        if (Vector.isVector(v))
            return ( this._x===v.x && this._y===v.y)
        else
            return ( this._x===v[0] && this._y===v[1])
    }

    isParallel(v) {
        if ( !Vector.isVector(v) && !Array.isArray(v) )
            return false;
        if (this.eq(v))
            return true;

        if (Vector.isVector(v)) {
            return this.isParallelToVector(v)
        }

        return this.isParallelToArray(v)
    }

    protected isParallelToVector(v:Vector) {
        return this.isParallelToArray([v._x,v._y])
    }

    protected isParallelToArray(a:Array<number>) {
        if (a.length<2)
            return false;
        if (this._x===0 && a[0]===0) return true;
        if (this._y===0 && a[1]===0) return true;

        return ( abs( a[0]/this._x-a[1]/this._y ) < 0.0001)        
    }

    isSameDirection(v) {
        if (!this.isParallel(v))
            return false;

        let v2 = v;
        if (!Vector.isVector(v)) v2 = new Vector(v);
        let bearer1 = this.angle();
        let bearer2 = v2.angle();
        return Math.sign(bearer1)===Math.sign(bearer2) 
    }

    add(v) {
         if ( Array.isArray(v) ) {
             if (v.length>0) this._x = this._x + v[0];
             if (v.length>1) this._y = this._y + v[1];
         } 
         else if ( Vector.isVector(v) ) {
             this._x = this._x + v.x;
             this._y = this._y + v.y;
         }
         else {
            throw new Error("invalid argument")
         }
         return this;
    }

    min(v) {
        if ( Array.isArray(v) ) {
            if (v.length>0) this._x = this._x - v[0];
            if (v.length>1) this._y = this._y - v[1];
        } 
        else if ( Vector.isVector(v) ) {
            this._x = this._x - v.x;
            this._y = this._y - v.y;
        }
        else {
           throw new Error("invalid argument")
        }
        return this;
   }

    multiply(v) {
        if ( typeof v==='number') {
            this._x = v*this._x;
            this._y = v*this._y;
        }
        else if ( Array.isArray(v) ) {
            let res = 0;
            if (v.length>0) res += (this._x * v[0]);
            if (v.length>1) res += (this._y * v[1]);
            return res;
        } 
        else if ( Vector.isVector(v) ) {
            return(this._x * v.x +  this._y * v.y);
        }
        else {
           throw new Error("invalid argument")
        }
        return this;
   }

    static add(v1,v2) {
        let v = new Vector(v1);
        v.add(v2);
        return v;   
    }

    static min(v1,v2) {
        let v = new Vector(v1);
        v.min(v2);
        return v;   
    }

    static multiply(v1,v2) {
        if ( typeof v1==='number') {
            if (Vector.isVector(v2) || Array.isArray(v2))  {
                let v = new Vector(v2)
                return v.multiply(v1)
            }
            else {
                throw new Error("invalid argument")
            }
        }

        if (Vector.isVector(v1))
            return v1.multiply(v2);   
        if (Array.isArray(v1)) {
            let v = new Vector(v1);
            return v.multiply(v2)
        }
        throw new Error("invalid argument")
    }

    
    static eq(v1,v2) {
        if (v1===undefined) return false;
        if (Vector.isVector(v1))
            return v1.eq(v2);   
        if (Array.isArray(v1)) {
            let v = new Vector(v1);
            return v.eq(v2)
        }
        throw new Error("invalid argument")
    }

    static isParallel(v1,v2) {
        if (v1===undefined) return false;
        if (Vector.isVector(v1))
            return v1.isParallel(v2);   
        if (Array.isArray(v1)) {
            let v = new Vector(v1);
            return v.isParallel(v2)
        }
        throw new Error("invalid argument")
    }
 
    static isVector(v) {
        return ( v!==undefined && typeof v === 'object' && v.x!==undefined && v.y!==undefined && v._class!==undefined && v._class===CLASS_VECTOR)
    }

    len() {
        return Math.sqrt(this._x*this._x+this._y*this._y);
    }

    angle() {
        if (this.len()===0)
            return undefined;
        return asin(this._x/this.len());
    }
}