import { Singleton } from '../../../../base/decorators'
import { COPY, copiedMessage } from '../../../support/copy'
import { SupportSettingsDialogService } from '../base/service'

/** Support dialog for desktop (web-ui): details are copied to the clipboard */
@Singleton
export class DesktopSupportSettingsDialogService extends SupportSettingsDialogService {
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
