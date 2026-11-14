import { a as getUserAgent, d as setFailed, f as setOutput, i as RequestError, n as getOctokit, o as debug, p as setSecret, r as request, s as getInput, t as context, u as saveState } from "./github-C7tXd-Py.js";
import { createPrivateKey, subtle } from "node:crypto";
// node_modules/.pnpm/@octokit+oauth-methods@6.0.5/node_modules/@octokit/oauth-methods/dist-bundle/index.js
function requestToOAuthBaseUrl(request) {
	const endpointDefaults = request.endpoint.DEFAULTS;
	if (/^https:\/\/(api\.)?github\.com$/.test(endpointDefaults.baseUrl)) return "https://github.com";
	if (/^https:\/\/api\..*\.ghe\.com$/.test(endpointDefaults.baseUrl)) return endpointDefaults.baseUrl.replace("api.", "");
	return endpointDefaults.baseUrl.replace("/api/v3", "");
}
async function oauthRequest(request, route, parameters) {
	const withOAuthParameters = {
		baseUrl: requestToOAuthBaseUrl(request),
		headers: { accept: "application/json" },
		...parameters
	};
	const response = await request(route, withOAuthParameters);
	if ("error" in response.data) {
		const error = new RequestError(`${response.data.error_description} (${response.data.error}, ${response.data.error_uri})`, 400, { request: request.endpoint.merge(route, withOAuthParameters) });
		error.response = response;
		throw error;
	}
	return response;
}
async function exchangeWebFlowCode(options) {
	const response = await oauthRequest(options.request || request, "POST /login/oauth/access_token", {
		client_id: options.clientId,
		client_secret: options.clientSecret,
		code: options.code,
		redirect_uri: options.redirectUrl
	});
	const authentication = {
		clientType: options.clientType,
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		token: response.data.access_token,
		scopes: response.data.scope.split(/\s+/).filter(Boolean)
	};
	if (options.clientType === "github-app") {
		if ("refresh_token" in response.data) {
			const apiTimeInMs = new Date(response.headers.date).getTime();
			authentication.refreshToken = response.data.refresh_token, authentication.expiresAt = toTimestamp(apiTimeInMs, response.data.expires_in), authentication.refreshTokenExpiresAt = toTimestamp(apiTimeInMs, response.data.refresh_token_expires_in);
		}
		delete authentication.scopes;
	}
	return {
		...response,
		authentication
	};
}
function toTimestamp(apiTimeInMs, expirationInSeconds) {
	return new Date(apiTimeInMs + expirationInSeconds * 1e3).toISOString();
}
async function createDeviceCode(options) {
	const request$5 = options.request || request;
	const parameters = { client_id: options.clientId };
	if ("scopes" in options && Array.isArray(options.scopes)) parameters.scope = options.scopes.join(" ");
	return oauthRequest(request$5, "POST /login/device/code", parameters);
}
async function exchangeDeviceCode(options) {
	const response = await oauthRequest(options.request || request, "POST /login/oauth/access_token", {
		client_id: options.clientId,
		device_code: options.code,
		grant_type: "urn:ietf:params:oauth:grant-type:device_code"
	});
	const authentication = {
		clientType: options.clientType,
		clientId: options.clientId,
		token: response.data.access_token,
		scopes: response.data.scope.split(/\s+/).filter(Boolean)
	};
	if ("clientSecret" in options) authentication.clientSecret = options.clientSecret;
	if (options.clientType === "github-app") {
		if ("refresh_token" in response.data) {
			const apiTimeInMs = new Date(response.headers.date).getTime();
			authentication.refreshToken = response.data.refresh_token, authentication.expiresAt = toTimestamp2(apiTimeInMs, response.data.expires_in), authentication.refreshTokenExpiresAt = toTimestamp2(apiTimeInMs, response.data.refresh_token_expires_in);
		}
		delete authentication.scopes;
	}
	return {
		...response,
		authentication
	};
}
function toTimestamp2(apiTimeInMs, expirationInSeconds) {
	return new Date(apiTimeInMs + expirationInSeconds * 1e3).toISOString();
}
async function checkToken(options) {
	const response = await (options.request || request)("POST /applications/{client_id}/token", {
		headers: { authorization: `basic ${btoa(`${options.clientId}:${options.clientSecret}`)}` },
		client_id: options.clientId,
		access_token: options.token
	});
	const authentication = {
		clientType: options.clientType,
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		token: options.token,
		scopes: response.data.scopes
	};
	if (response.data.expires_at) authentication.expiresAt = response.data.expires_at;
	if (options.clientType === "github-app") delete authentication.scopes;
	return {
		...response,
		authentication
	};
}
async function refreshToken(options) {
	const response = await oauthRequest(options.request || request, "POST /login/oauth/access_token", {
		client_id: options.clientId,
		client_secret: options.clientSecret,
		grant_type: "refresh_token",
		refresh_token: options.refreshToken
	});
	const apiTimeInMs = new Date(response.headers.date).getTime();
	const authentication = {
		clientType: "github-app",
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		token: response.data.access_token,
		refreshToken: response.data.refresh_token,
		expiresAt: toTimestamp3(apiTimeInMs, response.data.expires_in),
		refreshTokenExpiresAt: toTimestamp3(apiTimeInMs, response.data.refresh_token_expires_in)
	};
	return {
		...response,
		authentication
	};
}
function toTimestamp3(apiTimeInMs, expirationInSeconds) {
	return new Date(apiTimeInMs + expirationInSeconds * 1e3).toISOString();
}
async function resetToken(options) {
	const response = await (options.request || request)("PATCH /applications/{client_id}/token", {
		headers: { authorization: `basic ${btoa(`${options.clientId}:${options.clientSecret}`)}` },
		client_id: options.clientId,
		access_token: options.token
	});
	const authentication = {
		clientType: options.clientType,
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		token: response.data.token,
		scopes: response.data.scopes
	};
	if (response.data.expires_at) authentication.expiresAt = response.data.expires_at;
	if (options.clientType === "github-app") delete authentication.scopes;
	return {
		...response,
		authentication
	};
}
async function deleteToken(options) {
	return (options.request || request)("DELETE /applications/{client_id}/token", {
		headers: { authorization: `basic ${btoa(`${options.clientId}:${options.clientSecret}`)}` },
		client_id: options.clientId,
		access_token: options.token
	});
}
async function deleteAuthorization(options) {
	return (options.request || request)("DELETE /applications/{client_id}/grant", {
		headers: { authorization: `basic ${btoa(`${options.clientId}:${options.clientSecret}`)}` },
		client_id: options.clientId,
		access_token: options.token
	});
}
/* v8 ignore next: we always pass a custom request in tests -- @preserve */
// node_modules/.pnpm/@octokit+auth-oauth-device@8.0.5/node_modules/@octokit/auth-oauth-device/dist-bundle/index.js
async function getOAuthAccessToken(state, options) {
	const cachedAuthentication = getCachedAuthentication(state, options.auth);
	if (cachedAuthentication) return cachedAuthentication;
	const { data: verification } = await createDeviceCode({
		clientType: state.clientType,
		clientId: state.clientId,
		request: options.request || state.request,
		scopes: options.auth.scopes || state.scopes
	});
	await state.onVerification(verification);
	const authentication = await waitForAccessToken(options.request || state.request, state.clientId, state.clientType, verification);
	state.authentication = authentication;
	return authentication;
}
function getCachedAuthentication(state, auth2) {
	if (auth2.refresh === true) return false;
	if (!state.authentication) return false;
	if (state.clientType === "github-app") return state.authentication;
	const authentication = state.authentication;
	return ("scopes" in auth2 && auth2.scopes || state.scopes).join(" ") === authentication.scopes.join(" ") ? authentication : false;
}
async function wait(seconds) {
	await new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
}
async function waitForAccessToken(request, clientId, clientType, verification) {
	try {
		const options = {
			clientId,
			request,
			code: verification.device_code
		};
		const { authentication } = clientType === "oauth-app" ? await exchangeDeviceCode({
			...options,
			clientType: "oauth-app"
		}) : await exchangeDeviceCode({
			...options,
			clientType: "github-app"
		});
		return {
			type: "token",
			tokenType: "oauth",
			...authentication
		};
	} catch (error) {
		if (!error.response) throw error;
		const errorType = error.response.data.error;
		if (errorType === "authorization_pending") {
			await wait(verification.interval);
			return waitForAccessToken(request, clientId, clientType, verification);
		}
		if (errorType === "slow_down") {
			await wait(verification.interval + 7);
			return waitForAccessToken(request, clientId, clientType, verification);
		}
		throw error;
	}
}
async function auth$3(state, authOptions) {
	return getOAuthAccessToken(state, { auth: authOptions });
}
async function hook$3(state, request, route, parameters) {
	let endpoint = request.endpoint.merge(route, parameters);
	if (/\/login\/(oauth\/access_token|device\/code)$/.test(endpoint.url)) return request(endpoint);
	const { token } = await getOAuthAccessToken(state, {
		request,
		auth: { type: "oauth" }
	});
	endpoint.headers.authorization = `token ${token}`;
	return request(endpoint);
}
var VERSION$3 = "0.0.0-development";
function createOAuthDeviceAuth(options) {
	const requestWithDefaults = options.request || request.defaults({ headers: { "user-agent": `octokit-auth-oauth-device.js/${VERSION$3} ${getUserAgent()}` } });
	const { request: request$3 = requestWithDefaults, ...otherOptions } = options;
	const state = options.clientType === "github-app" ? {
		...otherOptions,
		clientType: "github-app",
		request: request$3
	} : {
		...otherOptions,
		clientType: "oauth-app",
		request: request$3,
		scopes: options.scopes || []
	};
	if (!options.clientId) throw new Error("[@octokit/auth-oauth-device] \"clientId\" option must be set (https://github.com/octokit/auth-oauth-device.js#usage)");
	if (!options.onVerification) throw new Error("[@octokit/auth-oauth-device] \"onVerification\" option must be a function (https://github.com/octokit/auth-oauth-device.js#usage)");
	return Object.assign(auth$3.bind(null, state), { hook: hook$3.bind(null, state) });
}
/* v8 ignore next 2 -- @preserve */
// node_modules/.pnpm/@octokit+auth-oauth-user@6.0.4/node_modules/@octokit/auth-oauth-user/dist-bundle/index.js
var VERSION$2 = "0.0.0-development";
async function getAuthentication(state) {
	if ("code" in state.strategyOptions) {
		const { authentication } = await exchangeWebFlowCode({
			clientId: state.clientId,
			clientSecret: state.clientSecret,
			clientType: state.clientType,
			onTokenCreated: state.onTokenCreated,
			...state.strategyOptions,
			request: state.request
		});
		return {
			type: "token",
			tokenType: "oauth",
			...authentication
		};
	}
	if ("onVerification" in state.strategyOptions) {
		const authentication = await createOAuthDeviceAuth({
			clientType: state.clientType,
			clientId: state.clientId,
			onTokenCreated: state.onTokenCreated,
			...state.strategyOptions,
			request: state.request
		})({ type: "oauth" });
		return {
			clientSecret: state.clientSecret,
			...authentication
		};
	}
	if ("token" in state.strategyOptions) return {
		type: "token",
		tokenType: "oauth",
		clientId: state.clientId,
		clientSecret: state.clientSecret,
		clientType: state.clientType,
		onTokenCreated: state.onTokenCreated,
		...state.strategyOptions
	};
	throw new Error("[@octokit/auth-oauth-user] Invalid strategy options");
}
async function auth$2(state, options = {}) {
	if (!state.authentication) state.authentication = state.clientType === "oauth-app" ? await getAuthentication(state) : await getAuthentication(state);
	if (state.authentication.invalid) throw new Error("[@octokit/auth-oauth-user] Token is invalid");
	const currentAuthentication = state.authentication;
	if ("expiresAt" in currentAuthentication) {
		if (options.type === "refresh" || new Date(currentAuthentication.expiresAt) < /* @__PURE__ */ new Date()) {
			const { authentication } = await refreshToken({
				clientType: "github-app",
				clientId: state.clientId,
				clientSecret: state.clientSecret,
				refreshToken: currentAuthentication.refreshToken,
				request: state.request
			});
			state.authentication = {
				tokenType: "oauth",
				type: "token",
				...authentication
			};
		}
	}
	if (options.type === "refresh") {
		if (state.clientType === "oauth-app") throw new Error("[@octokit/auth-oauth-user] OAuth Apps do not support expiring tokens");
		if (!currentAuthentication.hasOwnProperty("expiresAt")) throw new Error("[@octokit/auth-oauth-user] Refresh token missing");
		await state.onTokenCreated?.(state.authentication, { type: options.type });
	}
	if (options.type === "check" || options.type === "reset") {
		const method = options.type === "check" ? checkToken : resetToken;
		try {
			const { authentication } = await method({
				clientType: state.clientType,
				clientId: state.clientId,
				clientSecret: state.clientSecret,
				token: state.authentication.token,
				request: state.request
			});
			state.authentication = {
				tokenType: "oauth",
				type: "token",
				...authentication
			};
			if (options.type === "reset") await state.onTokenCreated?.(state.authentication, { type: options.type });
			return state.authentication;
		} catch (error) {
			if (error.status === 404) {
				error.message = "[@octokit/auth-oauth-user] Token is invalid";
				state.authentication.invalid = true;
			}
			throw error;
		}
	}
	if (options.type === "delete" || options.type === "deleteAuthorization") {
		const method = options.type === "delete" ? deleteToken : deleteAuthorization;
		try {
			await method({
				clientType: state.clientType,
				clientId: state.clientId,
				clientSecret: state.clientSecret,
				token: state.authentication.token,
				request: state.request
			});
		} catch (error) {
			if (error.status !== 404) throw error;
		}
		state.authentication.invalid = true;
		return state.authentication;
	}
	return state.authentication;
}
var ROUTES_REQUIRING_BASIC_AUTH = /\/applications\/[^/]+\/(token|grant)s?/;
function requiresBasicAuth(url) {
	return url && ROUTES_REQUIRING_BASIC_AUTH.test(url);
}
async function hook$2(state, request, route, parameters = {}) {
	const endpoint = request.endpoint.merge(route, parameters);
	if (/\/login\/(oauth\/access_token|device\/code)$/.test(endpoint.url)) return request(endpoint);
	if (requiresBasicAuth(endpoint.url)) {
		const credentials = btoa(`${state.clientId}:${state.clientSecret}`);
		endpoint.headers.authorization = `basic ${credentials}`;
		return request(endpoint);
	}
	const { token } = state.clientType === "oauth-app" ? await auth$2({
		...state,
		request
	}) : await auth$2({
		...state,
		request
	});
	endpoint.headers.authorization = "token " + token;
	return request(endpoint);
}
function createOAuthUserAuth({ clientId, clientSecret, clientType = "oauth-app", request: request$2 = request.defaults({ headers: { "user-agent": `octokit-auth-oauth-app.js/${VERSION$2} ${getUserAgent()}` } }), onTokenCreated, ...strategyOptions }) {
	const state = Object.assign({
		clientType,
		clientId,
		clientSecret,
		onTokenCreated,
		strategyOptions,
		request: request$2
	});
	return Object.assign(auth$2.bind(null, state), { hook: hook$2.bind(null, state) });
}
createOAuthUserAuth.VERSION = VERSION$2;
/* v8 ignore if -- @preserve */
/* v8 ignore next -- @preserve */
// node_modules/.pnpm/@octokit+auth-oauth-app@9.0.5/node_modules/@octokit/auth-oauth-app/dist-bundle/index.js
async function auth$1(state, authOptions) {
	if (authOptions.type === "oauth-app") return {
		type: "oauth-app",
		clientId: state.clientId,
		clientSecret: state.clientSecret,
		clientType: state.clientType,
		headers: { authorization: `basic ${btoa(`${state.clientId}:${state.clientSecret}`)}` }
	};
	if ("factory" in authOptions) {
		const { type, ...options } = {
			...authOptions,
			...state
		};
		return authOptions.factory(options);
	}
	const common = {
		clientId: state.clientId,
		clientSecret: state.clientSecret,
		request: state.request,
		...authOptions
	};
	return (state.clientType === "oauth-app" ? await createOAuthUserAuth({
		...common,
		clientType: state.clientType
	}) : await createOAuthUserAuth({
		...common,
		clientType: state.clientType
	}))();
}
async function hook$1(state, request2, route, parameters) {
	let endpoint = request2.endpoint.merge(route, parameters);
	if (/\/login\/(oauth\/access_token|device\/code)$/.test(endpoint.url)) return request2(endpoint);
	if (state.clientType === "github-app" && !requiresBasicAuth(endpoint.url)) throw new Error(`[@octokit/auth-oauth-app] GitHub Apps cannot use their client ID/secret for basic authentication for endpoints other than "/applications/{client_id}/**". "${endpoint.method} ${endpoint.url}" is not supported.`);
	const credentials = btoa(`${state.clientId}:${state.clientSecret}`);
	endpoint.headers.authorization = `basic ${credentials}`;
	try {
		return await request2(endpoint);
	} catch (error) {
		if (error.status !== 401) throw error;
		error.message = `[@octokit/auth-oauth-app] "${endpoint.method} ${endpoint.url}" does not support clientId/clientSecret basic authentication.`;
		throw error;
	}
}
var VERSION$1 = "0.0.0-development";
function createOAuthAppAuth(options) {
	const state = Object.assign({
		request: request.defaults({ headers: { "user-agent": `octokit-auth-oauth-app.js/${VERSION$1} ${getUserAgent()}` } }),
		clientType: "oauth-app"
	}, options);
	return Object.assign(auth$1.bind(null, state), { hook: hook$1.bind(null, state) });
}
/* v8 ignore next -- @preserve */
// node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/lib/utils.js
/**
* @param {string} privateKey
* @returns {boolean}
*/
function isPkcs1(privateKey) {
	return privateKey.includes("-----BEGIN RSA PRIVATE KEY-----");
}
/**
* @param {string} privateKey
* @returns {boolean}
*/
function isOpenSsh(privateKey) {
	return privateKey.includes("-----BEGIN OPENSSH PRIVATE KEY-----");
}
/**
* @param {string} str
* @returns {ArrayBuffer}
*/
function string2ArrayBuffer(str) {
	const buf = new ArrayBuffer(str.length);
	const bufView = new Uint8Array(buf);
	for (let i = 0, strLen = str.length; i < strLen; i++) bufView[i] = str.charCodeAt(i);
	return buf;
}
/**
* @param {string} pem
* @returns {ArrayBuffer}
*/
function getDERfromPEM(pem) {
	const pemB64 = pem.trim().split("\n").slice(1, -1).join("");
	return string2ArrayBuffer(atob(pemB64));
}
/**
* @param {import('../internals').Header} header
* @param {import('../internals').Payload} payload
* @returns {string}
*/
function getEncodedMessage(header, payload) {
	return `${base64encodeJSON(header)}.${base64encodeJSON(payload)}`;
}
/**
* @param {ArrayBuffer} buffer
* @returns {string}
*/
function base64encode(buffer) {
	var binary = "";
	var bytes = new Uint8Array(buffer);
	var len = bytes.byteLength;
	for (var i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
	return fromBase64(btoa(binary));
}
/**
* @param {string} base64
* @returns {string}
*/
function fromBase64(base64) {
	return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
/**
* @param {Record<string,unknown>} obj
* @returns {string}
*/
function base64encodeJSON(obj) {
	return fromBase64(btoa(JSON.stringify(obj)));
}
// node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/lib/crypto-node.js
function convertPrivateKey(privateKey) {
	if (!isPkcs1(privateKey)) return privateKey;
	return createPrivateKey(privateKey).export({
		type: "pkcs8",
		format: "pem"
	});
}
// node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/lib/get-token.js
/**
* @param {import('../internals').GetTokenOptions} options
* @returns {Promise<string>}
*/
async function getToken({ privateKey, payload }) {
	const convertedPrivateKey = convertPrivateKey(privateKey);
	/* c8 ignore start */
	if (isPkcs1(convertedPrivateKey)) throw new Error("[universal-github-app-jwt] Private Key is in PKCS#1 format, but only PKCS#8 is supported. See https://github.com/gr2m/universal-github-app-jwt#private-key-formats");
	/* c8 ignore stop */
	if (isOpenSsh(convertedPrivateKey)) throw new Error("[universal-github-app-jwt] Private Key is in OpenSSH format, but only PKCS#8 is supported. See https://github.com/gr2m/universal-github-app-jwt#private-key-formats");
	const algorithm = {
		name: "RSASSA-PKCS1-v1_5",
		hash: { name: "SHA-256" }
	};
	/** @type {import('../internals').Header} */
	const header = {
		alg: "RS256",
		typ: "JWT"
	};
	const privateKeyDER = getDERfromPEM(convertedPrivateKey);
	const importedKey = await subtle.importKey("pkcs8", privateKeyDER, algorithm, false, ["sign"]);
	const encodedMessage = getEncodedMessage(header, payload);
	const encodedMessageArrBuf = string2ArrayBuffer(encodedMessage);
	return `${encodedMessage}.${base64encode(await subtle.sign(algorithm.name, importedKey, encodedMessageArrBuf))}`;
}
// node_modules/.pnpm/universal-github-app-jwt@2.2.2/node_modules/universal-github-app-jwt/index.js
/**
* @param {import(".").Options} options
* @returns {Promise<import(".").Result>}
*/
async function githubAppJwt({ id, privateKey, now = Math.floor(Date.now() / 1e3) }) {
	const privateKeyWithNewlines = privateKey.replace(/\\n/g, "\n");
	const nowWithSafetyMargin = now - 30;
	const expiration = nowWithSafetyMargin + 600;
	return {
		appId: id,
		expiration,
		token: await getToken({
			privateKey: privateKeyWithNewlines,
			payload: {
				iat: nowWithSafetyMargin,
				exp: expiration,
				iss: id
			}
		})
	};
}
// node_modules/.pnpm/toad-cache@3.7.4/node_modules/toad-cache/dist/toad-cache.mjs
/**
* toad-cache
*
* @copyright 2026 Igor Savin <kibertoad@gmail.com>
* @license MIT
* @version 3.7.3
*/
/**
* Validates the shared cache constructor parameters.
* Both values must be non-negative integers.
*
* @param {number} max
* @param {number} ttlInMsecs
*/
function validateCacheParams(max, ttlInMsecs) {
	if (typeof max !== "number" || !Number.isInteger(max) || max < 0) throw new Error("Invalid max value");
	if (typeof ttlInMsecs !== "number" || !Number.isInteger(ttlInMsecs) || ttlInMsecs < 0) throw new Error("Invalid ttl value");
}
var LruObject = class {
	constructor(max = 1e3, ttlInMsecs = 0) {
		validateCacheParams(max, ttlInMsecs);
		this.first = null;
		this.items = Object.create(null);
		this.last = null;
		this.size = 0;
		this.max = max;
		this.ttl = ttlInMsecs;
	}
	bumpLru(item) {
		if (this.last === item) return;
		const last = this.last;
		const next = item.next;
		const prev = item.prev;
		if (this.first === item) this.first = next;
		item.next = null;
		item.prev = last;
		last.next = item;
		if (prev !== null) prev.next = next;
		/* v8 ignore next 3 -- next is always non-null here: the early return above guarantees item !== this.last in a well-formed list */
		if (next !== null) next.prev = prev;
		this.last = item;
	}
	clear() {
		this.items = Object.create(null);
		this.first = null;
		this.last = null;
		this.size = 0;
	}
	delete(key) {
		const item = this.items[key];
		if (item !== void 0) {
			delete this.items[key];
			this.size--;
			if (item.prev !== null) item.prev.next = item.next;
			if (item.next !== null) item.next.prev = item.prev;
			if (this.first === item) this.first = item.next;
			if (this.last === item) this.last = item.prev;
		}
	}
	deleteMany(keys) {
		for (var i = 0; i < keys.length; i++) this.delete(keys[i]);
	}
	evict() {
		if (this.size > 0) {
			const item = this.first;
			delete this.items[item.key];
			if (--this.size === 0) {
				this.first = null;
				this.last = null;
			} else {
				this.first = item.next;
				this.first.prev = null;
			}
		}
	}
	expiresAt(key) {
		const item = this.items[key];
		if (item !== void 0) return item.expiry;
	}
	get(key) {
		const item = this.items[key];
		if (item !== void 0) {
			if (this.ttl > 0 && item.expiry <= Date.now()) {
				this.delete(key);
				return;
			}
			this.bumpLru(item);
			return item.value;
		}
	}
	getMany(keys) {
		const result = new Array(keys.length);
		for (var i = 0; i < keys.length; i++) result[i] = this.get(keys[i]);
		return result;
	}
	keys() {
		return Object.keys(this.items);
	}
	set(key, value) {
		const existing = this.items[key];
		if (existing !== void 0) {
			existing.value = value;
			existing.expiry = this.ttl > 0 ? Date.now() + this.ttl : this.ttl;
			this.bumpLru(existing);
			return;
		}
		if (this.max > 0 && this.size >= this.max) this.evict();
		const item = {
			expiry: this.ttl > 0 ? Date.now() + this.ttl : this.ttl,
			key,
			prev: this.last,
			next: null,
			value
		};
		this.items[key] = item;
		if (++this.size === 1) this.first = item;
		else this.last.next = item;
		this.last = item;
	}
};
// node_modules/.pnpm/@octokit+auth-app@8.3.1/node_modules/@octokit/auth-app/dist-node/index.js
async function getAppAuthentication({ appId, privateKey, timeDifference, createJwt }) {
	try {
		if (createJwt) {
			const { jwt, expiresAt } = await createJwt(appId, timeDifference);
			return {
				type: "app",
				token: jwt,
				appId,
				expiresAt
			};
		}
		const authOptions = {
			id: appId,
			privateKey
		};
		if (timeDifference) Object.assign(authOptions, { now: Math.floor(Date.now() / 1e3) + timeDifference });
		const appAuthentication = await githubAppJwt(authOptions);
		return {
			type: "app",
			token: appAuthentication.token,
			appId: appAuthentication.appId,
			expiresAt: (/* @__PURE__ */ new Date(appAuthentication.expiration * 1e3)).toISOString()
		};
	} catch (error) {
		if (privateKey === "-----BEGIN RSA PRIVATE KEY-----") throw new Error("The 'privateKey` option contains only the first line '-----BEGIN RSA PRIVATE KEY-----'. If you are setting it using a `.env` file, make sure it is set on a single line with newlines replaced by '\n'");
		else throw error;
	}
}
function getCache() {
	return new LruObject(15e3, 354e4);
}
async function get(cache, options) {
	const cacheKey = optionsToCacheKey(options);
	const result = await cache.get(cacheKey);
	if (!result) return;
	const [token, createdAt, expiresAt, repositorySelection, permissionsString, singleFileName] = result.split("|");
	return {
		token,
		createdAt,
		expiresAt,
		permissions: options.permissions || permissionsString.split(/,/).reduce((permissions2, string) => {
			if (/!$/.test(string)) permissions2[string.slice(0, -1)] = "write";
			else permissions2[string] = "read";
			return permissions2;
		}, {}),
		repositoryIds: options.repositoryIds,
		repositoryNames: options.repositoryNames,
		singleFileName,
		repositorySelection
	};
}
async function set(cache, options, data) {
	const key = optionsToCacheKey(options);
	const permissionsString = options.permissions ? "" : Object.keys(data.permissions).map((name) => `${name}${data.permissions[name] === "write" ? "!" : ""}`).join(",");
	const value = [
		data.token,
		data.createdAt,
		data.expiresAt,
		data.repositorySelection,
		permissionsString,
		data.singleFileName
	].join("|");
	await cache.set(key, value);
}
function optionsToCacheKey({ installationId, permissions = {}, repositoryIds = [], repositoryNames = [] }) {
	const permissionsString = Object.keys(permissions).sort().map((name) => permissions[name] === "read" ? name : `${name}!`).join(",");
	return [
		installationId,
		repositoryIds.sort().join(","),
		repositoryNames.join(","),
		permissionsString
	].filter(Boolean).join("|");
}
function toTokenAuthentication({ installationId, token, createdAt, expiresAt, repositorySelection, permissions, repositoryIds, repositoryNames, singleFileName }) {
	return Object.assign({
		type: "token",
		tokenType: "installation",
		token,
		installationId,
		permissions,
		createdAt,
		expiresAt,
		repositorySelection
	}, repositoryIds ? { repositoryIds } : null, repositoryNames ? { repositoryNames } : null, singleFileName ? { singleFileName } : null);
}
async function getInstallationAuthentication(state, options, customRequest) {
	const installationId = Number(options.installationId || state.installationId);
	if (!installationId) throw new Error("[@octokit/auth-app] installationId option is required for installation authentication.");
	if (options.factory) {
		const { type, factory, oauthApp, ...factoryAuthOptions } = {
			...state,
			...options
		};
		return factory(factoryAuthOptions);
	}
	const request = customRequest || state.request;
	return getInstallationAuthenticationConcurrently(state, {
		...options,
		installationId
	}, request);
}
var pendingPromises = /* @__PURE__ */ new Map();
function getInstallationAuthenticationConcurrently(state, options, request) {
	const cacheKey = optionsToCacheKey(options);
	if (pendingPromises.has(cacheKey)) return pendingPromises.get(cacheKey);
	const promise = getInstallationAuthenticationImpl(state, options, request).finally(() => pendingPromises.delete(cacheKey));
	pendingPromises.set(cacheKey, promise);
	return promise;
}
async function getInstallationAuthenticationImpl(state, options, request) {
	if (!options.refresh) {
		const result = await get(state.cache, options);
		if (result) {
			const { token: token2, createdAt: createdAt2, expiresAt: expiresAt2, permissions: permissions2, repositoryIds: repositoryIds2, repositoryNames: repositoryNames2, singleFileName: singleFileName2, repositorySelection: repositorySelection2 } = result;
			return toTokenAuthentication({
				installationId: options.installationId,
				token: token2,
				createdAt: createdAt2,
				expiresAt: expiresAt2,
				permissions: permissions2,
				repositorySelection: repositorySelection2,
				repositoryIds: repositoryIds2,
				repositoryNames: repositoryNames2,
				singleFileName: singleFileName2
			});
		}
	}
	const appAuthentication = await getAppAuthentication(state);
	const payload = {
		installation_id: options.installationId,
		mediaType: { previews: ["machine-man"] },
		headers: { authorization: `bearer ${appAuthentication.token}` }
	};
	if (options.repositoryIds) Object.assign(payload, { repository_ids: options.repositoryIds });
	if (options.repositoryNames) Object.assign(payload, { repositories: options.repositoryNames });
	if (options.permissions) Object.assign(payload, { permissions: options.permissions });
	const { data: { token, expires_at: expiresAt, repositories, permissions: permissionsOptional, repository_selection: repositorySelectionOptional, single_file: singleFileName } } = await request("POST /app/installations/{installation_id}/access_tokens", payload);
	const permissions = permissionsOptional || {};
	const repositorySelection = repositorySelectionOptional || "all";
	const repositoryIds = repositories ? repositories.map((r) => r.id) : void 0;
	const repositoryNames = repositories ? repositories.map((repo) => repo.name) : void 0;
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	const cacheOptions = {
		token,
		createdAt,
		expiresAt,
		repositorySelection,
		permissions,
		repositoryIds,
		repositoryNames
	};
	if (singleFileName) Object.assign(payload, { singleFileName });
	await set(state.cache, options, cacheOptions);
	const cacheData = {
		installationId: options.installationId,
		token,
		createdAt,
		expiresAt,
		repositorySelection,
		permissions,
		repositoryIds,
		repositoryNames
	};
	if (singleFileName) Object.assign(cacheData, { singleFileName });
	return toTokenAuthentication(cacheData);
}
async function auth(state, authOptions) {
	switch (authOptions.type) {
		case "app": return getAppAuthentication(state);
		case "oauth-app": return state.oauthApp({ type: "oauth-app" });
		case "installation": return getInstallationAuthentication(state, {
			...authOptions,
			type: "installation"
		});
		case "oauth-user": return state.oauthApp(authOptions);
		default: throw new Error(`Invalid auth type: ${authOptions.type}`);
	}
}
var PATHS = [
	"/app",
	"/app/hook/config",
	"/app/hook/deliveries",
	"/app/hook/deliveries/{delivery_id}",
	"/app/hook/deliveries/{delivery_id}/attempts",
	"/app/installations",
	"/app/installations/{installation_id}",
	"/app/installations/{installation_id}/access_tokens",
	"/app/installations/{installation_id}/suspended",
	"/app/installation-requests",
	"/marketplace_listing/accounts/{account_id}",
	"/marketplace_listing/plan",
	"/marketplace_listing/plans",
	"/marketplace_listing/plans/{plan_id}/accounts",
	"/marketplace_listing/stubbed/accounts/{account_id}",
	"/marketplace_listing/stubbed/plan",
	"/marketplace_listing/stubbed/plans",
	"/marketplace_listing/stubbed/plans/{plan_id}/accounts",
	"/orgs/{org}/installation",
	"/repos/{owner}/{repo}/installation",
	"/users/{username}/installation",
	"/enterprises/{enterprise}/installation"
];
function routeMatcher(paths) {
	const regex = `^(?:${paths.map((p) => p.split("/").map((c) => c.startsWith("{") ? "(?:.+?)" : c).join("/")).map((r) => `(?:${r})`).join("|")})$`;
	return new RegExp(regex, "i");
}
var REGEX = routeMatcher(PATHS);
function requiresAppAuth(url) {
	return !!url && REGEX.test(url.split("?")[0]);
}
var FIVE_SECONDS_IN_MS = 5e3;
function isNotTimeSkewError(error) {
	return !(error.message.match(/'Expiration time' claim \('exp'\) is too far in the future/) || error.message.match(/'Expiration time' claim \('exp'\) must be a numeric value representing the future time at which the assertion expires/) || error.message.match(/'Issued at' claim \('iat'\) must be an Integer representing the time that the assertion was issued/));
}
async function hook(state, request, route, parameters) {
	const endpoint = request.endpoint.merge(route, parameters);
	const url = endpoint.url;
	if (/\/login\/oauth\/access_token$/.test(url)) return request(endpoint);
	if (requiresAppAuth(url.replace(request.endpoint.DEFAULTS.baseUrl, ""))) {
		const { token: token2 } = await getAppAuthentication(state);
		endpoint.headers.authorization = `bearer ${token2}`;
		let response;
		try {
			response = await request(endpoint);
		} catch (error) {
			if (isNotTimeSkewError(error)) throw error;
			if (typeof error.response.headers.date === "undefined") throw error;
			const diff = Math.floor((Date.parse(error.response.headers.date) - Date.parse((/* @__PURE__ */ new Date()).toString())) / 1e3);
			state.log.warn(error.message);
			state.log.warn(`[@octokit/auth-app] GitHub API time and system time are different by ${diff} seconds. Retrying request with the difference accounted for.`);
			const { token: token3 } = await getAppAuthentication({
				...state,
				timeDifference: diff
			});
			endpoint.headers.authorization = `bearer ${token3}`;
			return request(endpoint);
		}
		return response;
	}
	if (requiresBasicAuth(url)) {
		const authentication = await state.oauthApp({ type: "oauth-app" });
		endpoint.headers.authorization = authentication.headers.authorization;
		return request(endpoint);
	}
	const { token, createdAt } = await getInstallationAuthentication(state, {}, request.defaults({ baseUrl: endpoint.baseUrl }));
	endpoint.headers.authorization = `token ${token}`;
	return sendRequestWithRetries(state, request, endpoint, createdAt);
}
async function sendRequestWithRetries(state, request, options, createdAt, retries = 0) {
	const timeSinceTokenCreationInMs = +/* @__PURE__ */ new Date() - +new Date(createdAt);
	try {
		return await request(options);
	} catch (error) {
		if (error.status !== 401) throw error;
		if (timeSinceTokenCreationInMs >= FIVE_SECONDS_IN_MS) {
			if (retries > 0) error.message = `After ${retries} retries within ${timeSinceTokenCreationInMs / 1e3}s of creating the installation access token, the response remains 401. At this point, the cause may be an authentication problem or a system outage. Please check https://www.githubstatus.com for status information`;
			throw error;
		}
		++retries;
		const awaitTime = retries * 1e3;
		state.log.warn(`[@octokit/auth-app] Retrying after 401 response to account for token replication delay (retry: ${retries}, wait: ${awaitTime / 1e3}s)`);
		await new Promise((resolve) => setTimeout(resolve, awaitTime));
		return sendRequestWithRetries(state, request, options, createdAt, retries);
	}
}
var VERSION = "8.3.1";
function createAppAuth(options) {
	if (!options.appId) throw new Error("[@octokit/auth-app] appId option is required");
	if (!options.privateKey && !options.createJwt) throw new Error("[@octokit/auth-app] privateKey option is required");
	else if (options.privateKey && options.createJwt) throw new Error("[@octokit/auth-app] privateKey and createJwt options are mutually exclusive");
	if ("installationId" in options && !options.installationId) throw new Error("[@octokit/auth-app] installationId is set to a falsy value");
	const log = options.log || {};
	if (typeof log.warn !== "function") log.warn = console.warn.bind(console);
	const request$1 = options.request || request.defaults({ headers: { "user-agent": `octokit-auth-app.js/${VERSION} ${getUserAgent()}` } });
	const state = Object.assign({
		request: request$1,
		cache: getCache()
	}, options, options.installationId ? { installationId: Number(options.installationId) } : {}, {
		log,
		oauthApp: createOAuthAppAuth({
			clientType: "github-app",
			clientId: options.clientId || "",
			clientSecret: options.clientSecret || "",
			request: request$1
		})
	});
	return Object.assign(auth.bind(null, state), { hook: hook.bind(null, state) });
}
/* v8 ignore next - permissions are optional per OpenAPI spec, but we think that is incorrect -- @preserve */
/* v8 ignore next - repositorySelection are optional per OpenAPI spec, but we think that is incorrect -- @preserve */
/* v8 ignore start - due to skipped tests, see https://github.com/octokit/auth-app.js/pull/580 -- @preserve */
/* v8 ignore end -- @preserve */
// create-token/index.ts
function getPermissionInput(name) {
	const value = getInput(name) || "read";
	if (value !== "read" && value !== "write") throw new Error(`${name} value can be only \`read\` or \`write\``);
	return value;
}
try {
	const clientId = getInput("client-id", { required: true });
	const privateKey = getInput("private-key", { required: true });
	const permissions = {
		contents: getPermissionInput("permission-contents"),
		pull_requests: getPermissionInput("permission-pull-requests")
	};
	const authentication = await createAppAuth({
		appId: clientId,
		privateKey
	})({ type: "app" });
	const octokit = getOctokit(authentication.token);
	const { data: installation } = await octokit.rest.apps.getRepoInstallation({ ...context.repo });
	const { data } = await octokit.rest.apps.createInstallationAccessToken({
		installation_id: installation.id,
		repositories: [context.repo.repo],
		permissions
	});
	setSecret(data.token);
	debug("Auth token has been successfully created");
	saveState("token", data.token);
	setOutput("app-slug", installation.app_slug);
	setOutput("token", data.token);
} catch (error) {
	setFailed(error instanceof Error ? error.message : String(error));
}
export {};
