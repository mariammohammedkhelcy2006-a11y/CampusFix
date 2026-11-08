const {
	backendRequest,
	clearSessionCookie,
	isSameOriginRequest,
	sendJson,
	validateAdminSession,
} = require("../../server/admin-session");

module.exports = async function adminLogout(request, response) {
	if (request.method !== "POST") {
		response.setHeader("Allow", "POST");
		return sendJson(response, 405, { detail: "Method not allowed" });
	}
	if (!isSameOriginRequest(request)) {
		return sendJson(response, 403, { detail: "Request origin is not allowed" });
	}

	const session = await validateAdminSession(request);
	if (!session.authorized) {
		if (session.status === 401 || session.status === 403) {
			clearSessionCookie(response);
			response.statusCode = 204;
			return response.end();
		}
		return sendJson(response, session.status, { detail: "Logout could not be completed" });
	}

	try {
		const logoutResponse = await backendRequest("/auth/logout", {
			method: "POST",
			token: session.token,
		});
		if (logoutResponse.status === 401) {
			clearSessionCookie(response);
			response.statusCode = 204;
			return response.end();
		}
		if (!logoutResponse.ok) {
			return sendJson(response, logoutResponse.status, { detail: "Logout could not be completed" });
		}

		clearSessionCookie(response);
		response.statusCode = 204;
		return response.end();
	} catch {
		return sendJson(response, 503, { detail: "Authentication service is unavailable" });
	}
};
