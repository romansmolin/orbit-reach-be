import { AxiosError } from 'axios'
import { ILogger } from '../infra/logger/logger.interface'

export const handleAxiosErrors = (error: AxiosError, logger: ILogger) => {
    if (error.response) {
        logger.debug('Axios Response Error:', {
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers,
        })
    } else if (error.request) {
        logger.debug('Axios No Response:', {
            request: error.request,
        })
    } else {
        logger.debug('Axios Config/Error:', {
            message: error.message,
            config: error.config,
        })
    }
}
