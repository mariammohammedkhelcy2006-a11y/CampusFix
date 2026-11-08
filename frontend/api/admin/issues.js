const {
	backendRequest,
	sendBackendResponse,
	sendJson,
	validateAdminSession,
} = require("../../server/admin-session");

module.exports = async function adminIssues(request, response) {
	if (request.method !== "GET") {
		response.setHeader("Allow", "GET");
		return sendJson(response, 405, { detail: "Method not allowed" });
	}

	const session = await validateAdminSession(request);
	if (!session.authorized) {
		return sendJson(response, session.status, { detail: "Administrator session is invalid or expired" });
	}

	try {
		const backendResponse = await backendRequest("/issues", { token: session.token });
		return sendBackendResponse(response, backendResponse);
	} catch {
		return sendJson(response, 503, { detail: "Reports are temporarily unavailable" });
	}
};
