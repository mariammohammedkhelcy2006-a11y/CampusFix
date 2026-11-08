const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const adminLogin = require("../api/admin/login");
const adminLogout = require("../api/admin/logout");
const adminDashboard = require("../api/admin/dashboard");
const adminIssues = require("../api/admin/issues");
const adminIssue = require("../api/admin/issues/[issue_id]");
const { COOKIE_NAME } = require("../server/admin-session");

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
});

function makeRequest({ method = "GET", cookie, body, query = {}, origin = "https://campus-fix-kelcy1.vercel.app" } = {}) {
	const headers = { host: "campus-fix-kelcy1.vercel.app", origin };
	if (cookie) headers.cookie = cookie;
	return { method, headers, body, query };
}

function makeResponse() {
	return {
		headers: {},
		statusCode: 200,
		setHeader(name, value) {
			this.headers[name.toLowerCase()] = value;
		},
		end(body = "") {
			this.body = body;
		},
	};
}

function backendResponse(payload, status = 200) {
	return new Response(payload === null ? null : JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function sessionCookie(token = "signed-admin-token") {
	return `${COOKIE_NAME}=${encodeURIComponent(token)}`;
}

test("admin login establishes an HttpOnly Secure cookie without returning the JWT", async () => {
	global.fetch = async (url) => {
		if (url.endsWith("/auth/login")) return backendResponse({ access_token: "signed-admin-token" });
		if (url.endsWith("/auth/me")) return backendResponse({ email: "admin@example.test", role: "admin" });
		throw new Error("Unexpected backend request");
	};
	const response = makeResponse();

	await adminLogin(makeRequest({
		method: "POST",
		body: { email: "admin@example.test", password: "correct-password" },
	}), response);

	assert.equal(response.statusCode, 200);
	assert.match(response.headers["set-cookie"], /HttpOnly/);
	assert.match(response.headers["set-cookie"], /Secure/);
	assert.match(response.headers["set-cookie"], /SameSite=Lax/);
	assert.doesNotMatch(response.body, /signed-admin-token/);
});

test("student account is denied the admin session", async () => {
	const backendCalls = [];
	global.fetch = async (url, options) => {
		backendCalls.push(url);
		if (url.endsWith("/auth/login")) return backendResponse({ access_token: "student-token" });
		if (url.endsWith("/auth/me")) return backendResponse({ email: "student@example.test", role: "student" });
		if (url.endsWith("/auth/logout")) return backendResponse(null, 204);
		throw new Error("Unexpected backend request");
	};
	const response = makeResponse();

	await adminLogin(makeRequest({
		method: "POST",
		body: { email: "student@example.test", password: "correct-password" },
	}), response);

	assert.equal(response.statusCode, 403);
	assert.equal(response.headers["set-cookie"], undefined);
	assert.ok(backendCalls.some((url) => url.endsWith("/auth/logout")));
});

test("incorrect credentials are rejected without setting a session cookie", async () => {
	global.fetch = async () => backendResponse({ detail: "Invalid email or password" }, 401);
	const response = makeResponse();

	await adminLogin(makeRequest({
		method: "POST",
		body: { email: "admin@example.test", password: "wrong-password" },
	}), response);

	assert.equal(response.statusCode, 401);
	assert.equal(response.headers["set-cookie"], undefined);
});

test("direct dashboard request without a valid cookie redirects before HTML is served", async () => {
	const response = makeResponse();

	await adminDashboard(makeRequest(), response);

	assert.equal(response.statusCode, 302);
	assert.equal(response.headers.location, "/control-panel");
	assert.doesNotMatch(response.body, /Admin dashboard/);
});

test("admin report APIs reject missing sessions before calling the backend", async () => {
	global.fetch = async () => {
		throw new Error("Backend must not be called without a session");
	};
	const listResponse = makeResponse();
	await adminIssues(makeRequest(), listResponse);
	const updateResponse = makeResponse();
	await adminIssue(makeRequest({
		method: "PATCH",
		query: { issue_id: "8" },
		body: { status: "Resolved" },
	}), updateResponse);
	const deleteResponse = makeResponse();
	await adminIssue(makeRequest({
		method: "DELETE",
		query: { issue_id: "8" },
	}), deleteResponse);

	assert.equal(listResponse.statusCode, 401);
	assert.equal(updateResponse.statusCode, 401);
	assert.equal(deleteResponse.statusCode, 401);
});

test("expired or revoked dashboard session does not receive protected HTML", async () => {
	global.fetch = async () => backendResponse({ detail: "Invalid or expired token" }, 401);
	const response = makeResponse();

	await adminDashboard(makeRequest({ cookie: sessionCookie() }), response);

	assert.equal(response.statusCode, 302);
	assert.doesNotMatch(response.body, /Admin dashboard/);
});

test("authenticated admin receives no-store dashboard HTML", async () => {
	global.fetch = async () => backendResponse({ email: "admin@example.test", role: "admin" });
	const response = makeResponse();

	await adminDashboard(makeRequest({ cookie: sessionCookie() }), response);

	assert.equal(response.statusCode, 200);
	assert.match(response.headers["content-type"], /text\/html/);
	assert.match(response.headers["cache-control"], /private, no-store/);
	assert.match(response.body, /admin-dashboard\.js/);
});

test("report viewing proxies to backend only after admin session validation", async () => {
	const calls = [];
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		if (url.endsWith("/auth/me")) return backendResponse({ role: "admin" });
		if (url.endsWith("/issues")) return backendResponse([{ id: 8, title: "Test report" }]);
		throw new Error("Unexpected backend request");
	};
	const response = makeResponse();

	await adminIssues(makeRequest({ cookie: sessionCookie() }), response);

	assert.equal(response.statusCode, 200);
	assert.equal(JSON.parse(response.body)[0].title, "Test report");
	assert.ok(calls[1].options.headers.Authorization.includes("signed-admin-token"));
});

test("status updates and report deletion are proxied with the validated admin token", async () => {
	const calls = [];
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		if (url.endsWith("/auth/me")) return backendResponse({ role: "admin" });
		if (url.endsWith("/issues/8/status")) return backendResponse({ id: 8, status: "Resolved" });
		if (url.endsWith("/issues/8")) return backendResponse({ deleted: true, image_cleanup: "not_required" });
		throw new Error("Unexpected backend request");
	};
	const patchResponse = makeResponse();
	await adminIssue(makeRequest({
		method: "PATCH",
		cookie: sessionCookie(),
		query: { issue_id: "8" },
		body: { status: "Resolved" },
	}), patchResponse);
	const deleteResponse = makeResponse();
	await adminIssue(makeRequest({
		method: "DELETE",
		cookie: sessionCookie(),
		query: { issue_id: "8" },
	}), deleteResponse);

	assert.equal(patchResponse.statusCode, 200);
	assert.equal(deleteResponse.statusCode, 200);
	assert.ok(calls.some(({ options }) => options.method === "PATCH"));
	assert.ok(calls.some(({ options }) => options.method === "DELETE"));
});

test("logout revokes the backend token before clearing the cookie", async () => {
	const calls = [];
	global.fetch = async (url, options) => {
		calls.push({ url, options });
		if (url.endsWith("/auth/me")) return backendResponse({ role: "admin" });
		if (url.endsWith("/auth/logout")) return backendResponse(null, 204);
		throw new Error("Unexpected backend request");
	};
	const response = makeResponse();

	await adminLogout(makeRequest({ method: "POST", cookie: sessionCookie() }), response);

	assert.equal(response.statusCode, 204);
	assert.match(response.headers["set-cookie"], /Max-Age=0/);
	assert.ok(calls.some(({ url }) => url.endsWith("/auth/logout")));
});

test("admin mutation requests reject cross-origin requests", async () => {
	const response = makeResponse();

	await adminIssue(makeRequest({
		method: "DELETE",
		cookie: sessionCookie(),
		query: { issue_id: "8" },
		origin: "https://attacker.example",
	}), response);

	assert.equal(response.statusCode, 403);
});
