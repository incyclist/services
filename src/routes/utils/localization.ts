import { RouteInfo } from "../list/types";

export const getLocalizedData = (data:RouteInfo , language:string='en'):RouteInfo => {
    
    const updated = {...data}

    if (language && data.localizedTitle ) {
        updated.title = data.localizedTitle[language]
        delete updated.localizedTitle
    }

    return updated;

}