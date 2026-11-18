import { Singleton } from '../../../../base/decorators'
import { COPY } from '../../../support/copy'
import { SupportSettingsPageService } from '../base/service'

/** Support page for mobile: details are shared via the share sheet, which confirms by itself */
@Singleton
export class MobileSupportSettingsPageService extends SupportSettingsPageService {
    protected getCopyLabel(): string {
        return COPY.shareDetailsLabel
    }

    protected getCopiedMessage(_address: string): string | undefined {
        return undefined
    }
}
