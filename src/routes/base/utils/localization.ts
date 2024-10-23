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