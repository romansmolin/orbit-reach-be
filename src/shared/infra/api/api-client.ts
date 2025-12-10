import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { ApiRequestOptions, IApiClient } from './api-client.interface'

const DEFAULT_TIMEOUT = 30_000

export class AxiosApiClient implements IApiClient {
    private readonly client: AxiosInstance

    constructor(baseURL?: string, defaultHeaders?: Record<string, string>) {
        this.client = axios.create({
            baseURL,
            timeout: DEFAULT_TIMEOUT,
            headers: defaultHeaders,
        })
    }

    async post<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse> {
        const response = await this.client.post<TResponse>(apiUrl, body, this.buildConfig(options))
        return response.data
    }

    async get<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse> {
        const response = await this.client.get<TResponse>(apiUrl, this.buildConfig(options))
        return response.data
    }

    async delete<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse> {
        const response = await this.client.delete<TResponse>(apiUrl, this.buildConfig(options))
        return response.data
    }

    async put<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse> {
        const response = await this.client.put<TResponse>(apiUrl, body, this.buildConfig(options))
        return response.data
    }

    async patch<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse> {
        const response = await this.client.patch<TResponse>(apiUrl, body, this.buildConfig(options))
        return response.data
    }

    private buildConfig(options?: ApiRequestOptions): AxiosRequestConfig {
        if (!options) return {}

        const config: AxiosRequestConfig = {}

        if (options.headers) {
            config.headers = { ...options.headers }
        }

        if (options.params) {
            config.params = { ...options.params }
        }

        if (options.responseType) {
            config.responseType = options.responseType
        }

        if (typeof options.timeoutMs === 'number') {
            config.timeout = options.timeoutMs
        }

        if (options.raw && typeof options.raw === 'object' && options.raw !== null) {
            Object.assign(config, options.raw as AxiosRequestConfig)
        }

        return config
    }
}
