import { valid } from "./valid";

export const dateFormat = (date:Date, fstr='%Y%m%d%H%M%S', utc:boolean=false) => {
    if ( !valid(date) || !(date instanceof Date))
        return;

    const prefix = utc ? 'getUTC' : 'get';

    
    
    return fstr.replace (/%[YmdHMS]/g, (m) => {
        switch (m) {
            case '%Y': return date[prefix + 'FullYear'] (); // no leading zeros required
            case '%m': m = 1 + date[prefix + 'Month'] (); break;
            case '%d': m = date[prefix + 'Date'] (); break;
            case '%H': m = date[prefix + 'Hours'] (); break;
            case '%M': m = date[prefix + 'Minutes'] (); break;
            case '%S': m = date[prefix + 'Seconds'] (); break;

            /* istanbul ignore next */            
            default: return m.slice (1); // this code can never be reached, but lint would complain about missing 'default'
        }
        // add leading zero if required
        return ('0' + m).slice (-2);
    });
}