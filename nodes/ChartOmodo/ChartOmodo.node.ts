import {
	NodeConnectionTypes,
	type IDataObject,
	type ILoadOptionsFunctions,
	type INodeListSearchResult,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { apiRequest } from './transport';

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
		icon: { light: 'file:../../icons/chartomodo.svg', dark: 'file:../../icons/chartomodo.dark.svg' },
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
					{ name: 'Get Many', value: 'getAll', action: 'Get many datasets' },
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
					{ name: 'Get Many', value: 'getAll', action: 'Get many charts' },
				],
				default: 'get',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
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

	// execute() — Task 5
}

function toResults(list: IDataObject[], label: string, filter?: string) {
	const f = filter?.toLowerCase() ?? '';
	return list
		.filter((d) => !f || String(d[label]).toLowerCase().includes(f))
		.map((d) => ({ name: String(d[label]), value: String(d.id) }));
}
