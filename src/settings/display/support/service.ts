import { getBindings } from "../../../api";
import { IAppInfo } from "../../../api/appInfo";
import { Injectable, Singleton } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer } from "../../../base/types";
import { IObserver } from "../../../types";
import { useUserSettings } from "../../service";
import { getDonationUrl, getGitHubUrl, getPrivacyUrl, getSlackUrl, getStravaUrl, getSupportEmail } from "../../support/urls";
import { SupportSettingsDisplayProps } from "./types";

@Singleton
export class SupportSettingsDisplayService extends IncyclistService {
    protected initialized: false
    protected observer:Observer;


    constructor() {
        super('SupportSettings')
    }

    open():IObserver {
        if (this.observer)
            this.close()
        
        this.observer =  new Observer()
        return this.observer
    }

    close() {
        this.observer.stop()
        delete this.observer
    }


    getDisplayProps():SupportSettingsDisplayProps { 
        return {
            uuid: this.getUserSettings().get('uuid',null),
            appVersion: this.getAppInfo().getAppVersion(),
            uiVersion: this.getAppInfo().getUIVersion(),
            privacyUrl: getPrivacyUrl(),
            supportUrls: [
                {label:'Slack',text:'Incyclist Slack Workspace', url:getSlackUrl() },
                {label:'Strava',text:'Incyclist Strava Club', url:getStravaUrl() },
                {label:'Email',text:getSupportEmail(), url:`mailto:${getSupportEmail()}` },
            ],
            gitHubUrl:getGitHubUrl(),
            donationUrl:getDonationUrl()
        }        
    }

    protected getAppInfo():IAppInfo {
        return this.getBindings().appInfo
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }



}

export const useSupportSettingsDisplay =() => new SupportSettingsDisplayService()