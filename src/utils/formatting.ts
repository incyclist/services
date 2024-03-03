import { valid } from "./valid";
/**
 * Formats a Date object into a string using the specified format string.
 * @param {Date} date - The Date object to format.
 * @param {string} [fstr='%Y%m%d%H%M%S'] - The format string. Defaults to '%Y%m%d%H%M%S'.
 * %Y represents year, %m represents month, %d represents day of month, 
 * %H is hour, %M is minute, %S is seconds
 * @param {boolean} [utc=false] - Indicates whether to use UTC methods for date extraction. Defaults to false.
 * @returns {string|undefined} The formatted date string or undefined if the input date is invalid.
 */
export const formatDateTime = (date:Date, fstr='%Y%m%d%H%M%S', utc:boolean=false) => {
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

/**
 * Formats a time duration given in seconds into a string in the format "HH:MM:SS" or "MM:SS".
 * @param {number} seconds - The time duration in seconds.
 * @param {boolean} cutMissing - Indicates whether to cut missing leading hours.
 * @returns {string|undefined} The formatted time string or undefined if seconds is undefined or null.
 */
export const formatTime = ( seconds:number, cutMissing:boolean ) =>{
    if ( seconds===undefined || seconds===null)
        return;

    let timeVal = seconds>=0 ? Math.round(seconds) : 0;

    const h = Math.floor(timeVal/3600);
    timeVal = timeVal % 3600;
    const m = Math.floor(timeVal/60);
    timeVal = timeVal % 60;
    const s = Math.floor(timeVal);

    if (cutMissing===undefined || cutMissing===false || h>0)
        return  h + ':'+ pad(m) +':' +pad(s);
    else 
        return pad(m) +':' +pad(s);
} 

/**
 * Formats a number into a string with a specified maximum number of digits and maximum length.
 * @param {number} value - The number to format.
 * @param {number} maxDigits - The maximum number of digits to include after the decimal point.
 * @param {number} [maxLength=-1] - The maximum length of the resulting string. Defaults to -1 (no maximum length).
 * @returns {string} The formatted number string.
 */
export const formatNumber = ( value:number,maxDigits:number, maxLength:number=-1 ):string =>{
    if (value===undefined || isNaN(value))
        return ''

    if (maxLength===-1)
        return value.toFixed(maxDigits).toString()

    let digits = maxDigits
    let str = value.toFixed(maxDigits).toString()
    while (digits>=0 && str !==undefined && str.length>maxLength+1) {
        str = value.toFixed(digits).toString()
        digits--
    }
    
    return str

}



/**
 * Pads a number with leading zeros to ensure it has a minimum specified size.
 * @param {number} value - The number to pad.
 * @param {number} [size=2] - The minimum size of the padded number. Defaults to 2.
 * @returns {string} The padded number as a string.
 */
export const pad = (value:number,size:number=2) => {
	let s = value.toString()
    let s1 = Math.floor(value).toString()
	while (s1.length < size ) {
        s = '0' + s;
        s1 = '0' +s1;
    }
	return s;
}


