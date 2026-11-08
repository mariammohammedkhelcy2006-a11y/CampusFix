const { sendJson, validateAdminSession } = require("../../server/admin-session");

module.exports = async function adminSession(request, response) {
	if (request.method !== "GET") {
		response.setHeader("Allow", "GET");
		return sendJson(response, 405, { detail: "Method not allowed" });
	}

	const session = await validateAdminSession(request);
	if (!session.authorized) {
		return sendJson(response, session.status, { detail: "Administrator session is invalid or expired" });
	}
	return sendJson(response, 200, { user: { email: session.user.email, role: session.user.role } });
};
