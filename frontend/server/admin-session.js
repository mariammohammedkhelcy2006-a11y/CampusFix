const COOKIE_NAME = "__Host-campusfix_admin_session";
const DEFAULT_API_URL = "https://campusfix-ixxc.onrender.com";

function getApiUrl() {
	return (process.env.CAMPUSFIX_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

function getSessionToken(request) {
	const cookieHeader = request.headers.cookie || "";
	for (const cookie of cookieHeader.split(";")) {
		const separator = cookie.indexOf("=");
		if (separator < 0 || cookie.slice(0, separator).trim() !== COOKIE_NAME) continue;
		try {
			return decodeURIComponent(cookie.slice(separator + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}

function setSessionCookie(response, token) {
	response.setHeader(
		"Set-Cookie",
		`${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`,
	);
}

function clearSessionCookie(response) {
	response.setHeader(
		"Set-Cookie",
		`${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
	);
}

function isSameOriginRequest(request) {
	const origin = request.headers.origin;
	const host = request.headers.host;
	if (!origin || !host) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

async function backendRequest(path, { method = "GET", token, body } = {}) {
	const headers = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body !== undefined) headers["Content-Type"] = "application/json";
	return fetch(`${getApiUrl()}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		cache: "no-store",
	});
}

async function validateAdminSession(request) {
	const token = getSessionToken(request);
	if (!token) return { authorized: false, status: 401 };

	try {
		const response = await backendRequest("/auth/me", { token });
		if (!response.ok) return { authorized: false, status: response.status };
		const user = await response.json();
		return user.role === "admin"
			? { authorized: true, token, user }
			: { authorized: false, status: 403 };
	} catch {
		return { authorized: false, status: 503 };
	}
}

function parseRequestBody(request) {
	if (request.body && typeof request.body === "object") return request.body;
	if (typeof request.body === "string") {
		try {
			return JSON.parse(request.body);
		} catch {
			return null;
		}
	}
	return null;
}

async function sendBackendResponse(response, backendResponse) {
	response.statusCode = backendResponse.status;
	const contentType = backendResponse.headers.get("content-type");
	if (contentType) response.setHeader("Content-Type", contentType);
	response.setHeader("Cache-Control", "no-store");
	const body = await backendResponse.text();
	response.end(body);
}

function sendJson(response, statusCode, payload) {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	response.setHeader("Cache-Control", "no-store");
	response.end(JSON.stringify(payload));
}

module.exports = {
	COOKIE_NAME,
	backendRequest,
	clearSessionCookie,
	getApiUrl,
	getSessionToken,
	isSameOriginRequest,
	parseRequestBody,
	sendBackendResponse,
	sendJson,
	setSessionCookie,
	validateAdminSession,
};
