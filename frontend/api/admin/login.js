const {
	backendRequest,
	isSameOriginRequest,
	parseRequestBody,
	sendJson,
	setSessionCookie,
} = require("../../server/admin-session");

module.exports = async function adminLogin(request, response) {
	if (request.method !== "POST") {
		response.setHeader("Allow", "POST");
		return sendJson(response, 405, { detail: "Method not allowed" });
	}
	if (!isSameOriginRequest(request)) {
		return sendJson(response, 403, { detail: "Request origin is not allowed" });
	}

	const credentials = parseRequestBody(request);
	if (!credentials || typeof credentials.email !== "string" || typeof credentials.password !== "string") {
		return sendJson(response, 400, { detail: "Email and password are required" });
	}

	try {
		const loginResponse = await backendRequest("/auth/login", {
			method: "POST",
			body: { email: credentials.email, password: credentials.password },
		});
		if (!loginResponse.ok) {
			return sendJson(response, loginResponse.status, { detail: "Invalid email or password" });
		}

		const loginData = await loginResponse.json();
		const token = loginData.access_token;
		if (typeof token !== "string" || !token) {
			return sendJson(response, 502, { detail: "Authentication service returned an invalid response" });
		}

		const userResponse = await backendRequest("/auth/me", { token });
		if (!userResponse.ok) {
			return sendJson(response, 503, { detail: "Could not verify the administrator account" });
		}

		const user = await userResponse.json();
		if (user.role !== "admin") {
			await backendRequest("/auth/logout", { method: "POST", token });
			return sendJson(response, 403, { detail: "Administrator access is required" });
		}

		setSessionCookie(response, token);
		return sendJson(response, 200, { user: { email: user.email, role: user.role } });
	} catch {
		return sendJson(response, 503, { detail: "Authentication service is unavailable" });
	}
};
