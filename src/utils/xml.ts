import {parseString} from 'xml2js';

export type JSONObject = string |
    number |
    boolean |
    { [x: string]: JSONObject; } |
    Array<JSONObject>;

export const toXml = (obj:JSONObject):string =>{
    const keys = Object.keys(obj);
    let xml = ''
    keys.forEach((key,index)=> { 
        const value = obj[key];
        if (value!==undefined)   
            xml+=`${index>0?' ':''}${key}="${value}"`;

    })
    return xml;
}

export const removeUTFBom = (str:string) => {
    //str = str.replace(/^\uFEFF/, '');

    while (str.charCodeAt(0)===0 || str.charCodeAt(0)===0xFEFF || str.charCodeAt(0)===0xFFFD)
        str = str.substring(1);

    return str
}

export const parseXml = async (str:string):Promise<XmlJSON> => { 
    return new Promise((resolve,reject) =>  {        

        const cleanStr = removeUTFBom(str)

        parseString(cleanStr, (err,result)=> {
            if (err) {
                    return reject(err);
            }
            return resolve( new XmlJSON(result)  );
        } )
    })
}

export class XmlJSON {

    
    constructor( private _json:JSONObject, private scheme?:string) {
        
    }

    get json() {        
        if (!this.scheme)
            return this._json
        return this.map( this.scheme, this._json[this.scheme] )
    }

    get raw() {
        return this._json
    }

    expectScheme(scheme:string) {
        this.detectScheme()
        if (scheme !== this.scheme) {
            if (!this._json[scheme])
                throw new Error(`cannot parse <${this.scheme}>`)

            this.scheme = scheme;
        }
    }

    getSchemeData():JSONObject {
        if (!this.scheme)
            return this._json
        return this._json[this.scheme]
    }

    detectScheme():string {
        const keys = Object.keys(this._json)
        if (keys.length===1) {
            this.scheme = keys[0]
            return this.scheme
        }
    }


    get (key) {
        const data = this.getSchemeData()
        const item = data[key] ? data[key][0]: undefined
        if (item===undefined)
            return undefined

        return this.map(key,item)
    }

    map(key,item) {
        if (typeof(item)==='object') {


            const keys = Object.keys(item)

            if (keys.length===1 && keys[0]==='0') {
                return this.map( key,item[keys[0]] ) 
            }
            if (keys.length===1 && `${keys[0]}s`===key) {
                return item[keys[0]].map( i=> this.map(key,i.$))
            }
            else if ( !keys.find( k=> isNaN(Number(k))) ) {
                const obj=[]

                keys.forEach( key=> {
                    if (key==='$') 
                        Object.assign(obj, this.map(key,item.$))
                    else 
                        obj.push(this.map(key,item[key]))
                })
                return obj

            }
            else {
                const obj = {}
                keys.forEach( key=> {
                    if (key==='$') 
                        Object.assign(obj, this.map(key,item.$))
                    else 
                        obj[key]=this.map(key,item[key])
                })
                return obj
            }
            
        }
        return item;

    }

}

