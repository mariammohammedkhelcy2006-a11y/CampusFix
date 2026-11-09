const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const vm = require("node:vm");

const adminLogin = require("../api/admin/login");
const adminLogout = require("../api/admin/logout");
const adminDashboard = require("../api/admin/dashboard-page");
const adminIssues = require("../api/admin/issues");
const adminIssue = require("../api/admin/issues/[issue_id]");
const { COOKIE_NAME } = require("../server/admin-session");
const vercelConfig = require("../vercel.json");

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

function makeDashboardBrowser(fetchImplementation) {
	const listeners = {};
	const redirects = [];
	const elements = new Map();
	const createElement = () => ({
		children: [],
		dataset: {},
		attributes: {},
		addEventListener(type, callback) {
			this.listeners = this.listeners || {};
			this.listeners[type] = callback;
		},
		appendChild(child) {
			this.children.push(child);
		},
		classList: {
			toggle(className) {
				this.open = !this.open;
				return this.open;
			},
		},
		replaceChildren(...children) {
			this.children = children;
		},
		setAttribute(name, value) {
			this.attributes[name] = value;
		},
	});
	const selectors = [
		".menu-toggle",
		".admin-sidebar",
		"#refresh-admin",
		"#admin-category-filter",
		"#admin-status-filter",
		"#admin-list",
		"#admin-logout",
		"#admin-message",
		"#stat-total",
		"#stat-pending",
		"#stat-progress",
		"#stat-resolved",
	];
	for (const selector of selectors) elements.set(selector, createElement());
	elements.get("#admin-category-filter").value = "all";
	elements.get("#admin-status-filter").value = "all";

	const document = {
		addEventListener(type, callback) {
			listeners[type] = callback;
		},
		createElement,
		querySelector(selector) {
			return elements.get(selector);
		},
	};
	const window = { location: { replace: (url) => redirects.push(url) } };
	const dashboardScript = fs.readFileSync(
		path.join(__dirname, "..", "admin-dashboard.js"),
		"utf8",
	);
	vm.runInNewContext(dashboardScript, { document, fetch: fetchImplementation, window, URL, Date });

	return { document, elements, listeners, redirects };
}

test("Vercel routes public dashboard URLs through the protected handler", () => {
	const rewrites = new Map(vercelConfig.rewrites.map(({ source, destination }) => [source, destination]));

	assert.equal(rewrites.get("/control-panel"), "/login.html");
	assert.equal(rewrites.get("/control-panel/"), "/login.html");
	assert.equal(rewrites.get("/admin.html"), "/api/admin/dashboard-page");
	assert.equal(rewrites.get("/admin.html/"), "/api/admin/dashboard-page");
	assert.equal(rewrites.get("/api/admin/dashboard"), "/api/admin/dashboard-page");
});

test("the /control-panel response contains no navigation before authentication", () => {
	const controlPanelRewrite = vercelConfig.rewrites.find(({ source }) => source === "/control-panel");
	assert.ok(controlPanelRewrite);
	assert.equal(controlPanelRewrite.destination, "/login.html");

	const controlPanelHtml = fs.readFileSync(
		path.join(__dirname, "..", controlPanelRewrite.destination.slice(1)),
		"utf8",
	);

	assert.match(controlPanelHtml, /Campus<span class="brand-accent">Fix<\/span> Admin/);
	assert.match(controlPanelHtml, /id="login-form"/);
	assert.match(controlPanelHtml, /id="login-email"/);
	assert.match(controlPanelHtml, /id="login-password"/);
	assert.match(controlPanelHtml, /id="login-message"/);
	assert.doesNotMatch(controlPanelHtml, /<nav\b|<a\b|menu-toggle|Homepage|Reports|Manage Reports|Logout/i);
});

test("public student homepage navigation remains available", () => {
	const homepageHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

	assert.match(homepageHtml, /<nav\b[^>]*id="site-nav"/);
	assert.match(homepageHtml, /href="#report-form">Report Issue<\/a>/);
	assert.match(homepageHtml, /href="reports\.html">View Reports<\/a>/);
});

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
	assert.doesNotMatch(response.body, /admin-logout|Manage Reports|Visit Homepage/);
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
	assert.match(response.body, /<link rel="stylesheet" href="\/style\.css">/);
	assert.match(response.body, /<script src="\/admin-dashboard\.js"><\/script>/);
	assert.doesNotMatch(response.body, /class="site-header"|class="site-nav"/);
	assert.match(response.body, /href="\/admin\.html">Dashboard<\/a>/);
	assert.match(response.body, /href="\/reports\.html">View Reports<\/a>/);
	assert.match(response.body, /href="#manage-reports">Manage Reports<\/a>/);
	assert.match(response.body, /href="\/index\.html">Visit Homepage<\/a>/);
	assert.match(response.body, /<aside class="admin-sidebar" id="admin-sidebar">[\s\S]*?Dashboard[\s\S]*?Visit Homepage[\s\S]*?View Reports[\s\S]*?Manage Reports[\s\S]*?<div class="admin-sidebar-bottom">\s*<button[^>]*id="admin-logout"[^>]*>Logout<\/button>/);
	assert.match(response.body, /<div class="admin-main">\s*<main class="admin-page">/);
	assert.match(response.body, /<button[^>]*id="admin-logout"[^>]*>Logout<\/button>/);
	assert.match(response.body, /id="manage-reports"/);
	assert.match(response.body, /admin-dashboard\.js/);
});

test("admin sidebar CSS provides desktop positioning and mobile collapse rules", () => {
	const stylesheet = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
	const dashboardScript = fs.readFileSync(path.join(__dirname, "..", "admin-dashboard.js"), "utf8");

	assert.match(stylesheet, /\.admin-sidebar\s*\{[^}]*position:\s*fixed/);
	assert.match(stylesheet, /\.admin-main\s*\{[^}]*margin-left:\s*264px/);
	assert.match(stylesheet, /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*?\.admin-sidebar\s*\{[^}]*transform:\s*translateX\(-105%\)/);
	assert.match(stylesheet, /\.admin-sidebar\.open\s*\{\s*transform:\s*translateX\(0\)/);
	assert.match(stylesheet, /\.admin-main\s*\{\s*margin-left:\s*0/);
	assert.match(dashboardScript, /document\.querySelector\("\.admin-sidebar"\)/);
	assert.match(dashboardScript, /sidebar\.classList\.toggle\("open"\)/);
});

test("admin menu button collapses and expands the sidebar", async () => {
	const browser = makeDashboardBrowser(async (url) => {
		if (url === "/api/admin/issues") return { status: 200, ok: true, json: async () => [] };
		throw new Error(`Unexpected request: ${url}`);
	});
	browser.listeners.DOMContentLoaded();
	await new Promise((resolve) => setImmediate(resolve));

	const menuToggle = browser.elements.get(".menu-toggle");
	const sidebar = browser.elements.get(".admin-sidebar");
	menuToggle.listeners.click();
	assert.equal(sidebar.classList.open, true);
	assert.equal(menuToggle.attributes["aria-expanded"], "true");
	menuToggle.listeners.click();
	assert.equal(sidebar.classList.open, false);
	assert.equal(menuToggle.attributes["aria-expanded"], "false");
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
	assert.match(response.headers["set-cookie"], /HttpOnly/);
	assert.match(response.headers["set-cookie"], /Secure/);
	assert.match(response.headers["set-cookie"], /Max-Age=0/);
	assert.ok(calls.some(({ url }) => url.endsWith("/auth/logout")));

	global.fetch = async () => {
		throw new Error("Backend must not be called after the session cookie is cleared");
	};
	const dashboardResponse = makeResponse();
	await adminDashboard(makeRequest(), dashboardResponse);
	assert.equal(dashboardResponse.statusCode, 302);
	assert.equal(dashboardResponse.headers.location, "/control-panel");
	assert.doesNotMatch(dashboardResponse.body, /Admin dashboard/);
});

test("dashboard Logout button calls the secure endpoint and redirects after success", async () => {
	const fetchCalls = [];
	const browser = makeDashboardBrowser(async (url, options) => {
		fetchCalls.push({ url, options });
		if (url === "/api/admin/issues") {
			return { status: 200, ok: true, json: async () => [] };
		}
		if (url === "/api/admin/logout") return { status: 204, ok: true };
		throw new Error(`Unexpected request: ${url}`);
	});
	browser.listeners.DOMContentLoaded();
	await new Promise((resolve) => setImmediate(resolve));

	await browser.elements.get("#admin-logout").listeners.click();

	assert.equal(fetchCalls.find(({ url }) => url === "/api/admin/logout").options.method, "POST");
	assert.deepEqual(browser.redirects, ["/control-panel"]);
});

test("dashboard Logout button remains usable and does not redirect when logout fails", async () => {
	const browser = makeDashboardBrowser(async (url) => {
		if (url === "/api/admin/issues") return { status: 200, ok: true, json: async () => [] };
		if (url === "/api/admin/logout") return { status: 503, ok: false };
		throw new Error(`Unexpected request: ${url}`);
	});
	browser.listeners.DOMContentLoaded();
	await new Promise((resolve) => setImmediate(resolve));

	const button = browser.elements.get("#admin-logout");
	await button.listeners.click();

	assert.equal(button.disabled, false);
	assert.equal(browser.redirects.length, 0);
	assert.match(browser.elements.get("#admin-message").textContent, /logout could not be confirmed/i);
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
