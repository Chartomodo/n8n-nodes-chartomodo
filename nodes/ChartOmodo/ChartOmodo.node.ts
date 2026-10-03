import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodeListSearchResult,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { apiCode, apiMessage, apiRequest, idempotencyKeyPrefix } from './transport';
import { chunkRows, jsonBytes, pickFields, writeSummary } from './rows';

/** The API refuses bodies over 5 MB; stay under it with room for headers. */
const MAX_BODY_BYTES = 4_900_000;

const datasetLocator = {
	displayName: 'Dataset',
	name: 'datasetId',
	type: 'resourceLocator' as const,
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list' as const,
			typeOptions: { searchListMethod: 'searchDatasets', searchable: true },
		},
		{ displayName: 'ID', name: 'id', type: 'string' as const, placeholder: 'cm1abc…' },
	],
};

const chartLocator = {
	displayName: 'Chart',
	name: 'chartId',
	type: 'resourceLocator' as const,
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list' as const,
			typeOptions: { searchListMethod: 'searchCharts', searchable: true },
		},
		{ displayName: 'ID', name: 'id', type: 'string' as const, placeholder: 'cm1abc…' },
	],
};

export class ChartOmodo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ChartOmodo',
		name: 'chartOmodo',
		icon: {
			light: 'file:../../icons/chartomodo.svg',
			dark: 'file:../../icons/chartomodo.dark.svg',
		},
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Push data into ChartOmodo charts and read charts back',
		defaults: { name: 'ChartOmodo' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'chartOmodoApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Dataset', value: 'dataset' },
					{ name: 'Chart', value: 'chart' },
				],
				default: 'dataset',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['dataset'] } },
				options: [
					{
						name: 'Append Rows',
						value: 'append',
						action: 'Append rows to a dataset',
						description: 'Add every input item as a row',
					},
					{
						name: 'Create',
						value: 'create',
						action: 'Create a dataset',
						description: 'Create a dataset from every input item',
					},
					// Runs once per execution, not once per input item.
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many datasets',
						description: 'List up to 500 datasets, newest first',
					},
					{
						name: 'Replace Rows',
						value: 'replace',
						action: 'Replace all rows in a dataset',
						description: 'Swap every row for the input items in one step',
					},
				],
				default: 'replace',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['chart'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a chart',
						description: 'Title, type and embed URL',
					},
					{
						name: 'Get Data',
						value: 'getData',
						action: 'Get the data a chart draws',
						description: 'Categories and series values',
					},
					// Runs once per execution, not once per input item.
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many charts',
						description: 'List up to 500 charts',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				description: 'Dataset name, 1–100 characters',
				displayOptions: { show: { resource: ['dataset'], operation: ['create'] } },
			},
			{
				...datasetLocator,
				displayOptions: { show: { resource: ['dataset'], operation: ['replace', 'append'] } },
			},
			{
				...chartLocator,
				displayOptions: { show: { resource: ['chart'], operation: ['get', 'getData'] } },
			},
			{
				displayName: 'Fields to Send',
				name: 'fields',
				type: 'string',
				default: '',
				placeholder: 'date, revenue, channel',
				description:
					'Comma-separated field names. Empty sends every field of each item. Values must be text, numbers, true/false or empty; flatten nested data with a Set node first.',
				displayOptions: {
					show: { resource: ['dataset'], operation: ['create', 'replace', 'append'] },
				},
			},
		],
	};

	methods = {
		listSearch: {
			async searchDatasets(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const res = await apiRequest.call(this, 'GET', '/datasets');
				return { results: toResults(res.data as IDataObject[], 'name', filter) };
			},
			async searchCharts(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const res = await apiRequest.call(this, 'GET', '/charts');
				return { results: toResults(res.data as IDataObject[], 'title', filter) };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// Dataset writes take ALL items as rows of ONE write: one output item, paired to every input.
		if (resource === 'dataset' && ['create', 'replace', 'append'].includes(operation)) {
			const pairedItem = items.map((_, i) => ({ item: i }));
			try {
				const fields = this.getNodeParameter('fields', 0, '') as string;
				const rows = items.map((item) => pickFields(item.json, fields));
				if (operation === 'create') {
					// POST /datasets takes no Idempotency-Key.
					const name = this.getNodeParameter('name', 0) as string;
					assertFits(this, { name, rows });
					const res = await apiRequest.call(this, 'POST', '/datasets', { name, rows });
					return [[{ json: writeSummary(undefined, [res]), pairedItem }]];
				}
				const id = this.getNodeParameter('datasetId', 0, '', { extractValue: true }) as string;
				const path = `/datasets/${encodeURIComponent(id)}/rows`;
				const key = idempotencyKeyPrefix(
					this.getExecutionId(),
					this.getNode().id,
					this.getWorkflowDataProxy(0).$runIndex as number,
				);
				const responses: IDataObject[] = [];
				if (operation === 'replace') {
					// Replace must be one request: splitting it would show half the data between requests.
					assertFits(this, { rows });
					responses.push(
						await apiRequest.call(this, 'PUT', path, { rows }, { 'Idempotency-Key': `${key}:0` }),
					);
				} else {
					const chunks = chunkRows(rows, MAX_BODY_BYTES);
					let sent = 0;
					for (let n = 0; n < chunks.length; n++) {
						try {
							responses.push(
								await apiRequest.call(
									this,
									'POST',
									path,
									{ rows: chunks[n] },
									{ 'Idempotency-Key': `${key}:${n}` },
								),
							);
						} catch (error) {
							// Earlier chunks are committed; say so, and that row numbers are chunk-relative.
							if (n > 0 && error instanceof NodeApiError) {
								error.description = `Request ${n + 1} of ${chunks.length} failed; the first ${sent} rows were already appended (row numbers in the message count from item ${sent}). Retry On Fail skips them; running the workflow again appends them again.`;
								error.context.appendedRows = sent;
							}
							throw nodeError(this, error);
						}
						sent += chunks[n].length;
					}
				}
				return [[{ json: writeSummary(id, responses), pairedItem }]];
			} catch (error) {
				if (this.continueOnFail()) return [[{ json: failure(error), pairedItem }]];
				throw nodeError(this, error);
			}
		}

		// List operations run once, not once per input item.
		if (operation === 'getAll') {
			try {
				const res = await apiRequest.call(
					this,
					'GET',
					resource === 'dataset' ? '/datasets' : '/charts',
				);
				return [(res.data as IDataObject[]).map((json) => ({ json, pairedItem: { item: 0 } }))];
			} catch (error) {
				if (this.continueOnFail()) return [[{ json: failure(error), pairedItem: { item: 0 } }]];
				throw nodeError(this, error);
			}
		}

		const out: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const id = this.getNodeParameter('chartId', i, '', { extractValue: true }) as string;
				const path = `/charts/${encodeURIComponent(id)}${operation === 'getData' ? '/data' : ''}`;
				out.push({ json: await apiRequest.call(this, 'GET', path), pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: failure(error), pairedItem: { item: i } });
					continue;
				}
				throw nodeError(this, error, i);
			}
		}
		return [out];
	}
}

function toResults(list: IDataObject[], label: string, filter?: string) {
	const f = filter?.toLowerCase() ?? '';
	return list
		.filter((d) => !f || String(d[label]).toLowerCase().includes(f))
		.map((d) => ({ name: String(d[label]), value: String(d.id) }));
}

function assertFits(ctx: IExecuteFunctions, body: IDataObject) {
	if (jsonBytes(body) > MAX_BODY_BYTES) {
		throw new NodeOperationError(
			ctx.getNode(),
			'These rows are larger than the 5 MB the API accepts in one request.',
			{
				description:
					'Send fewer items, list only the needed columns in "Fields to Send", or use Create once and then Append Rows, which splits large inputs.',
			},
		);
	}
}

/**
 * apiRequest already throws NodeApiError with the API's message; re-wrapping it would be a no-op
 * that drops itemIndex, so set that directly. Anything else (bad parameter, size check) is an
 * operation error.
 */
function nodeError(ctx: IExecuteFunctions, error: unknown, itemIndex?: number) {
	if (error instanceof NodeApiError) {
		if (itemIndex !== undefined) error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeOperationError(ctx.getNode(), error as Error, { itemIndex });
}

/** continueOnFail output. Not apiMessage() for our own errors: it prefers `description`, which there is a hint or note. */
function failure(error: unknown): IDataObject {
	if (error instanceof NodeApiError) {
		// apiRequest already set message to the API's text; description may be our partial-append note.
		const out: IDataObject = { error: error.message, code: apiCode(error) };
		if (error.context.appendedRows !== undefined) out.appendedRows = error.context.appendedRows;
		return out;
	}
	const message = error instanceof NodeOperationError ? error.message : apiMessage(error);
	return { error: message, code: apiCode(error) };
}
