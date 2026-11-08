const {
	backendRequest,
	isSameOriginRequest,
	parseRequestBody,
	sendBackendResponse,
	sendJson,
	validateAdminSession,
} = require("../../../server/admin-session");

module.exports = async function adminIssue(request, response) {
	const issueId = request.query.issue_id;
	if (!/^\d+$/.test(String(issueId || ""))) {
		return sendJson(response, 400, { detail: "Issue ID is invalid" });
	}
	if (!["PATCH", "DELETE"].includes(request.method)) {
		response.setHeader("Allow", "PATCH, DELETE");
		return sendJson(response, 405, { detail: "Method not allowed" });
	}
	if (!isSameOriginRequest(request)) {
		return sendJson(response, 403, { detail: "Request origin is not allowed" });
	}

	const session = await validateAdminSession(request);
	if (!session.authorized) {
		return sendJson(response, session.status, { detail: "Administrator session is invalid or expired" });
	}

	let body;
	let path = `/issues/${issueId}`;
	if (request.method === "PATCH") {
		body = parseRequestBody(request);
		if (!body || typeof body.status !== "string") {
			return sendJson(response, 400, { detail: "A report status is required" });
		}
		path += "/status";
	}

	try {
		const backendResponse = await backendRequest(path, {
			method: request.method,
			token: session.token,
			body,
		});
		return sendBackendResponse(response, backendResponse);
	} catch {
		return sendJson(response, 503, { detail: "Report management is temporarily unavailable" });
	}
};
