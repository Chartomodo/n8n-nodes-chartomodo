import { NodeApiError, sleep } from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';

const MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_S = 5;
const MAX_RETRY_AFTER_S = 30;
/** 503 codes that will not clear up within seconds. */
const PERMANENT_503 = ['api_disabled', 'maintenance'];

type ErrorBody = { error?: { code?: string; message?: string } };

/**
 * Shape of what httpRequestWithAuthentication throws (n8n-core): a NodeApiError whose
 * `cause` is the AxiosError, with the parsed JSON body copied to `context.data`.
 */
type ThrownApiError = {
	message?: string;
	description?: string | null;
	httpCode?: string | null;
	context?: { data?: ErrorBody };
	cause?: { response?: { status?: number; headers?: Record<string, unknown>; data?: ErrorBody } };
};

function errorBody(error: unknown): ErrorBody | undefined {
	const e = error as ThrownApiError | undefined;
	return e?.context?.data ?? e?.cause?.response?.data;
}

/** The API's own error message ("rows[0].a is an object…"), not n8n's generic status text. */
export function apiMessage(error: unknown): string {
	const e = error as ThrownApiError | undefined;
	return errorBody(error)?.error?.message ?? e?.description ?? e?.message ?? String(error);
}

/** The API's error code (`nested_value`, `rate_limited`, …) when the server sent one. */
export function apiCode(error: unknown): string | undefined {
	return errorBody(error)?.error?.code;
}

/** Milliseconds to wait before retrying, or undefined when the error is not transient. */
export function retryDelayMs(error: unknown): number | undefined {
	const e = error as ThrownApiError | undefined;
	const status = Number(e?.httpCode ?? e?.cause?.response?.status);
	const transient =
		status === 429 || (status === 503 && !PERMANENT_503.includes(apiCode(error) ?? ''));
	if (!transient) return undefined;
	const seconds = Number(e?.cause?.response?.headers?.['retry-after']);
	const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_S;
	return Math.min(wait, MAX_RETRY_AFTER_S) * 1000;
}

/** Accepts "https://host", "https://host/" or "https://host/api/v1/". */
export function normalizeBaseUrl(baseUrl: string): string {
	return String(baseUrl).replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

/**
 * One authenticated call to /api/v1, retrying 429/503 after Retry-After (same headers, so the
 * same Idempotency-Key). `path` must already be encoded: `/datasets/${encodeURIComponent(id)}`.
 * Throws a NodeApiError whose message is the API's own text; apiMessage()/apiCode() read it back.
 * Callers can't change it by re-wrapping (no-op); set `error.context.itemIndex` if needed.
 */
export async function apiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	headers?: IDataObject,
): Promise<IDataObject> {
	const { baseUrl } = await this.getCredentials<{ baseUrl: string }>('chartOmodoApi');
	const options: IHttpRequestOptions = {
		method,
		url: `${normalizeBaseUrl(baseUrl)}/api/v1${path}`,
		body,
		headers,
		json: true,
	};
	for (let attempt = 0; ; attempt++) {
		try {
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'chartOmodoApi',
				options,
			)) as IDataObject;
		} catch (error) {
			const delay = retryDelayMs(error);
			if (delay === undefined || attempt >= MAX_RETRIES) {
				// Wrap the AxiosError, not n8n's NodeApiError: re-wrapping a NodeApiError returns it
				// unchanged and drops `message`, leaving the generic "Your request is invalid…".
				const cause = (error as { cause?: unknown }).cause ?? error;
				throw new NodeApiError(this.getNode(), cause as JsonObject, {
					message: apiMessage(error),
					description: apiCode(error),
				});
			}
			const signal = 'getExecutionCancelSignal' in this ? this.getExecutionCancelSignal() : undefined;
			await sleep(delay, signal);
		}
	}
}
