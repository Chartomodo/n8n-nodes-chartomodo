import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class ChartOmodoApi implements ICredentialType {
	name = 'chartOmodoApi';

	displayName = 'ChartOmodo API';

	icon: Icon = { light: 'file:../icons/chartomodo.svg', dark: 'file:../icons/chartomodo.dark.svg' };

	documentationUrl = 'https://chartomodo.com/developers/api';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create a token in ChartOmodo under Settings → API (Pro plan and higher)',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://chartomodo.com',
			description: 'Without /api/v1. Change only to test against a staging instance.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiToken}}' } },
	};

	// Same normalization as normalizeBaseUrl() in nodes/ChartOmodo/transport.ts.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.baseUrl.replace(/\\/+$/, "").replace(/\\/api\\/v1$/, "")}}/api/v1',
			url: '/me',
		},
	};
}
