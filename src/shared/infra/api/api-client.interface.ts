export interface ApiRequestOptions {
    headers?: Record<string, string>
    params?: Record<string, string | number | boolean>
    responseType?: 'json' | 'arraybuffer' | 'document' | 'text' | 'stream'
    timeoutMs?: number
    raw?: Record<string, unknown>
}

export interface IApiClient {
    post<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse>
    get<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse>
    delete<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse>
    put<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse>
    patch<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse>
}
