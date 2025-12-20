import { LocalizedText } from "../../../i18n";
import { RouteInfo } from "../types";

export const getLocalizedData = (data:RouteInfo , language:string='en'):RouteInfo => {
    
    const updated = {...data}

    let keys=[];
    try {
        keys = Object.keys(data.localizedTitle)
    }
    catch { 
        // ignore
    }

    if (language && data.localizedTitle && keys.length>0 ) {
        updated.title = data.localizedTitle[language]
        delete updated.localizedTitle
    }

    return updated;

}

export const getLocalizedText = ( data:LocalizedText|string,  language:string='en') => {

    if (typeof(data)==='string')
        return data
    
    try {
        if (data[language])
            return data[language]

        let keys=[];
        try {
            keys = Object.keys(data)
        }
        catch { 
            // ignore
        }
        if (!keys.length)
            return

        const first = keys[0] 
        return data[first]
    }
    catch {
        return
    }

}