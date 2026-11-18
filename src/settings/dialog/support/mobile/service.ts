import { Singleton } from '../../../../base/decorators'
import { COPY } from '../../../support/copy'
import { SupportSettingsDialogService } from '../base/service'

/** Support dialog for mobile: details are shared via the share sheet, which confirms by itself */
@Singleton
export class MobileSupportSettingsDialogService extends SupportSettingsDialogService {
    protected getCopyLabel(): string {
        return COPY.shareDetailsLabel
    }

    protected getUuidActionLabel(): string {
        return COPY.uuidShareAction
    }

    protected getCopiedMessage(_address: string): string | undefined {
        return undefined
    }
}
