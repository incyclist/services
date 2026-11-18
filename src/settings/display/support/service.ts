import { getBindings } from "../../../api";
import { IAppInfo } from "../../../api/appInfo";
import { Injectable, Singleton } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer } from "../../../base/types";
import { IObserver } from "../../../types";
import { useUserSettings } from "../../service";
import { COPY, compactVersionText, copiedMessage } from "../../support/copy";
import { getDonationChannels, getDonationMode } from "../../support/donation";
import { buildSupportEmail } from "../../support/mailto";
import { getDonationUrl, getGitHubUrl, getPrivacyUrl, getSlackUrl, getStravaUrl, getSupportEmail, getSupportPageUrl } from "../../support/urls";
import type {
    DonationClickId, SupportAppInfoDisplayProps, SupportDonationDisplayProps, SupportHelpLink,
    SupportLinkClickId, SupportSettingsDisplayProps
} from "./types";

/**
 * Front-end service of the Settings > Support dialog: display props and callbacks, open/close.
 * It never touches the page bookkeeping (no IncyclistPageService), so the page underneath keeps
 * receiving pause/resume. The action handlers only log, they never throw.
 */
@Singleton
export class SupportSettingsDisplayService extends IncyclistService {
    protected initialized: false
    protected observer:Observer;


    constructor() {
        super('SupportSettings')
    }

    open():IObserver {
        try {
            if (this.observer)
                this.close()

            this.observer =  new Observer()
            this.safeLog({ message: 'support settings opened', mode: getDonationMode(this.getBindings()) })
            return this.observer
        }
        catch(err) {
            this.logError(err,'open')
        }
    }

    close() {
        try {
            if (!this.observer)
                return
            this.observer.stop()
            delete this.observer
        }
        catch(err) {
            this.logError(err,'close')
        }
    }

    /** Builds the display props from scratch, so version changes after a hot update are always current */
    getDisplayProps():SupportSettingsDisplayProps {
        try {
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
                donationUrl:getDonationUrl(),

                appInfo: this.buildAppInfo(),
                helpTitle: COPY.helpTitle,
                helpLinks: this.buildHelpLinks(),
                donation: this.buildDonation(),
            }
        }
        catch(err) {
            this.logError(err,'getDisplayProps')
        }
    }

    /** Logs a click on a support link (Strava, Slack, email, privacy, GitHub) */
    onLinkClicked(id: SupportLinkClickId): void {
        this.safeLog({ message: 'support link clicked', link: id })
    }

    /** Logs a click on a donation channel (or on the website link in 'website' mode) */
    onDonationClicked(id: DonationClickId): void {
        this.safeLog({ message: 'donation link clicked', donationChannel: id, mode: getDonationMode(this.getBindings()), source: 'settings' })
    }

    /** Logs the outcome of opening the prefilled support email */
    onEmailOpenResult(result: 'opened' | 'failed', error?: string): void {
        const event: Record<string, unknown> = { message: 'support email opened', openResult: result }
        if (result === 'failed' && error !== undefined)
            event.error = String(error).replace(/mailto:\S*/gi, 'mailto:<redacted>').slice(0, 200)
        this.safeLog(event)
    }

    /** Logs that the support details were copied or shared */
    onDetailsCopied(trigger: 'button' | 'fallback', result: 'success' | 'failed'): void {
        this.safeLog({ message: 'support details copied', trigger, copyResult: result })
    }

    protected safeLog(event: Record<string, unknown>) {
        try {
            this.logEvent(event)
        }
        catch { /* logging must never break the UI */ }
    }

    /** desktop (web-ui) copies to the clipboard, everything else (mobile) shares */
    protected isDesktop(): boolean {
        const channel = this.getAppInfo().getChannel()
        return channel === 'desktop' || channel === 'web'
    }

    protected buildAppInfo(): SupportAppInfoDisplayProps {
        const appInfo = this.getAppInfo()
        const appVersion = appInfo.getAppVersion()
        const uiVersion = appInfo.getUIVersion()
        return {
            title: COPY.appInfoTitle,
            appVersion,
            uiVersion,
            uuid: this.getUserSettings().get('uuid', null),
            privacyUrl: getPrivacyUrl(),
            labels: {
                appVersion: COPY.appVersionLabel,
                uiVersion: COPY.uiVersionLabel,
                uuid: COPY.uuidLabel,
                privacy: COPY.privacyLabel,
                privacyLink: COPY.privacyLinkLabel,
            },
            compactVersionText: compactVersionText(appVersion, uiVersion),
            uuidActionLabel: this.isDesktop() ? COPY.uuidCopyAction : COPY.uuidShareAction,
        }
    }

    protected buildHelpLinks(): SupportHelpLink[] {
        const appInfo = this.getAppInfo()
        const desktop = this.isDesktop()
        const mail = buildSupportEmail({
            address: getSupportEmail(),
            uuid: this.getUserSettings().get('uuid', null),
            appVersion: appInfo.getAppVersion(),
            uiVersion: appInfo.getUIVersion(),
        })

        return [
            { id: 'strava', label: COPY.stravaLabel, shortLabel: COPY.stravaShortLabel, url: getStravaUrl() },
            { id: 'slack', label: COPY.slackLabel, shortLabel: COPY.slackShortLabel, url: getSlackUrl() },
            {
                id: 'email', label: mail.address, shortLabel: COPY.emailShortLabel, url: mail.url,
                email: {
                    address: mail.address,
                    subject: mail.subject,
                    body: mail.body,
                    copyText: mail.copyText,
                    copyLabel: desktop ? COPY.copyDetailsLabel : COPY.shareDetailsLabel,
                    copiedMessage: desktop ? copiedMessage(mail.address) : undefined,
                }
            },
        ]
    }

    protected buildDonation(): SupportDonationDisplayProps {
        const mode = getDonationMode(this.getBindings())
        const base = {
            title: COPY.donationTitle,
            promise: COPY.promise,
            mode,
            note: COPY.note,
            otherHelpLinks: [
                { id: 'strava' as const, label: COPY.stravaLabel, url: getStravaUrl() },
                { id: 'github' as const, label: COPY.gitHubLabel, url: getGitHubUrl() },
            ],
        }

        if (mode === 'website') {
            const url = getSupportPageUrl()
            return { ...base, channels: [], websiteLink: { label: COPY.websiteLabel, url, host: this.getHost(url) } }
        }
        return { ...base, fundsText: COPY.fundsText, channels: getDonationChannels() }
    }

    protected getHost(url: string): string {
        try {
            return new URL(url).host
        }
        catch {
            return url
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
