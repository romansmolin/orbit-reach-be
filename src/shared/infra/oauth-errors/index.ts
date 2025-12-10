import { PLATFORM_ERROR_MAPPINGS } from './oauth-error-constants'
import { OAuthErrorHandler } from './oauth-error-handler'
import { IOAuthErrorHandler } from './oauth-error-handler.interface'

export default { PLATFORM_ERROR_MAPPINGS } as const
export type { IOAuthErrorHandler }
export { OAuthErrorHandler }
