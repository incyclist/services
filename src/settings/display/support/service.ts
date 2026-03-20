import { getBindings } from "../../../api";
import { IAppInfo } from "../../../api/appInfo";
import { Injectable, Singleton } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer } from "../../../base/types";
import { IObserver } from "../../../types";
import { useUserSettings } from "../../service";
import { SupportSettingsDisplayProps } from "./types";

const DEFAULT_PRIVACY_URL =  'https://incyclist.com/privacy'
const DEFAULT_SLACK_URL = 'https://join.slack.com/t/incyclist/shared_invite/zt-119wcvtjn-uiZ_Pw6gh5WLc0zT8jkfTg'
const DEFAULT_STRAVA_URL = 'https://www.strava.com/clubs/1029407'
const DEFAULT_EMAIL = 'support@incyclist.com'
const DEFAULT_GITHUB_URL = 'https://github.com/incyclist'
const DEFAULT_DONATION_URL = 'https://www.paypal.com/paypalme/incyclist'

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
            privacyUrl: process.env.PRIVACY_URL ?? DEFAULT_PRIVACY_URL,
            supportUrls: [
                {label:'Slack',text:'Incyclist Slack Workspace', url:process.env.PRIVACY_URL??DEFAULT_SLACK_URL },
                {label:'Strava',text:'Incyclist Strava Club', url:process.env.PRIVACY_URL??DEFAULT_STRAVA_URL },
                {label:'Email',text:process.env.SUPPORT_EMAIL??DEFAULT_EMAIL, url:`mailto:${process.env.SUPPORT_EMAIL??DEFAULT_EMAIL}` },
            ],
            gitHubUrl:process.env.GITHUB_URL??DEFAULT_GITHUB_URL,
            donationUrl:process.env.DONATION_URL??DEFAULT_DONATION_URL
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