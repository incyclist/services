import { RouteInfo } from "../types";

export const getLocalizedData = (data:RouteInfo , language:string='en'):RouteInfo => {
    
    const updated = {...data}

    if (language && data.localizedTitle && Array.isArray(data.localizedTitle) ) {
        updated.title = data.localizedTitle[language]
        delete updated.localizedTitle
    }

    return updated;

}