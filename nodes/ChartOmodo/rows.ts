import type { IDataObject } from 'n8n-workflow';

/** Bytes of the JSON the API will receive (its body cap is in bytes). */
export function jsonBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** `fields` = comma-separated column names; empty = send the item as-is. A listed column the item lacks is sent as null. */
export function pickFields(json: IDataObject, fields: string): IDataObject {
	const names = fields
		.split(',')
		.map((f) => f.trim())
		.filter(Boolean);
	if (names.length === 0) return json;
	const out: IDataObject = {};
	for (const name of names) out[name] = json[name] ?? null;
	return out;
}

/**
 * Splits rows into in-order chunks whose `{"rows":[…]}` body stays under
 * `maxBytes`. A single row over the budget goes alone; the API rejects it with
 * a clear 413 rather than this looping forever.
 */
export function chunkRows(rows: IDataObject[], maxBytes: number): IDataObject[][] {
	const chunks: IDataObject[][] = [];
	let current: IDataObject[] = [];
	let size = jsonBytes({ rows: [] });
	for (const row of rows) {
		const rowSize = jsonBytes(row) + 1; // + comma
		if (current.length > 0 && size + rowSize > maxBytes) {
			chunks.push(current);
			current = [];
			size = jsonBytes({ rows: [] });
		}
		current.push(row);
		size += rowSize;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

/**
 * One output item for a dataset write made of one or more requests. A deduped request
 * (`{"duplicate":true}`, sent again with an Idempotency-Key the API already applied) carries no
 * counts, so counts come from the last request that actually wrote.
 */
export function writeSummary(datasetId: string | undefined, responses: IDataObject[]): IDataObject {
	const fresh = responses.filter((r) => r.duplicate !== true);
	const last = fresh[fresh.length - 1] ?? {};
	const union = (key: string) => [
		...new Set(fresh.flatMap((r) => (r[key] as string[] | undefined) ?? [])),
	];
	const summary: IDataObject = {
		id: last.id ?? datasetId,
		rowCount: last.rowCount,
		columns: last.columns,
		addedColumns: union('addedColumns'),
		droppedColumns: union('droppedColumns'),
		requests: responses.length,
	};
	if (fresh.length < responses.length) summary.duplicate = true;
	return summary;
}
