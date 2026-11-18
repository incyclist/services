import { Singleton } from '../../../../base/decorators'
import { COPY, copiedMessage } from '../../../support/copy'
import { SupportSettingsPageService } from '../base/service'

/** Support page for desktop (web-ui): details are copied to the clipboard */
@Singleton
export class DesktopSupportSettingsPageService extends SupportSettingsPageService {
    protected getCopyLabel(): string {
        return COPY.copyDetailsLabel
    }

    protected getUuidActionLabel(): string {
        return COPY.uuidCopyAction
    }

    protected getCopiedMessage(address: string): string | undefined {
        return copiedMessage(address)
    }
}
