export interface IBlueskyConnectorService {
	connectBlueskyAccount(        
		userId: string,
        identifier: string,
        appPassword: string): Promise<{success: boolean}> 
}