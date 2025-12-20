import { getBindings } from "../../api";
import { INativeUI } from "../../api/ui";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";
import { LocalizedText } from "./types";

@Singleton
export class LocalizationService extends IncyclistService {




    constructor() {
        super('Localization')
    }

    getLanguage(defLanguage:string) {
        const selectedLanguage = this.getSelectedLanguage()
        if (selectedLanguage)
            return selectedLanguage;

        const detected = this.getUIBinding().detectLanguage()

        const language = (detected && detected.length>0) ? detected[0] : undefined
        if (language) {
            this.logger.logEvent({message:'language detected', language})
            this.setDetectedLanguage(language)
            return language
        }

        const stored = this.getUserSettings().getValue('localization.language',undefined)        

        return stored??defLanguage
    }

    setSelectedLanguage(language:string) {
       
        this.getUserSettings().set('preferences.language',language,true)
    }
    setDetectedLanguage(language:string) {
       
        this.getUserSettings().set('localization.language',language,true)
    }

    getSelectedLanguage():string { 
        return  this.getUserSettings().getValue('preferences.language',undefined)        
    }

    getCurrentLanguage():string {
        const prefered = this.getUserSettings().getValue('preferences.language',undefined)        
        const detected = this.getUIBinding().detectLanguage()
        const stored = this.getUserSettings().getValue('localization.language',undefined)       
       

        return prefered??detected??stored

    }

    getLocalized( multiLanguageTextField:LocalizedText, language?:string):string {
        const lang = language ?? this.getCurrentLanguage()

        let found;
        found = multiLanguageTextField[lang] 

        
        if (!found) {
            const detected = this.getUIBinding().detectLanguage()
            
            for (let i=0;i<detected.length && !found; i++) {
                const altLang = detected[i]
                found = multiLanguageTextField[altLang] 
            }
        }

        if (!found) {
            found =  multiLanguageTextField['en']
        }

        return found
    }


    translate(key) {
        // TODO
    }

    init( config) {
        // TODO
    }


    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getUIBinding(): INativeUI {
        return getBindings().ui
    }


}

export const useLocalization = () => new LocalizationService()