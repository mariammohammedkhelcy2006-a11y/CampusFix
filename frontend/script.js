const API_BASE_URL = "http://127.0.0.1:8000";

const AUTH_TOKEN_KEY = "campusfix_access_token";

function getAuthToken() {
	return sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
	if (token) {
		sessionStorage.setItem(AUTH_TOKEN_KEY, token);
	} else {
		clearAuthToken();
	}
}

function clearAuthToken() {
	sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

function isAuthenticated() {
	return Boolean(getAuthToken());
}

async function apiRequest(path, options = {}) {
	const token = getAuthToken();
	const headers = {
		"Content-Type": "application/json",
		...(options.headers || {}),
	};
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}
	const response = await fetch(`${API_BASE_URL}${path}`, {
		...options,
		headers,
	});
	return response;
}

async function refreshCurrentUser() {
	try {
		const response = await apiRequest("/auth/me");
		if (response.ok) {
			return await response.json();
		}
	} catch {
		clearAuthToken();
	}
	return null;
}

function updateNavigationAuth() {
	const nav = document.getElementById("site-nav");
	if (!nav) return;
	const authLinks = nav.querySelectorAll(".auth-nav-link");
	authLinks.forEach((link) => link.remove());

	const existingLogin = nav.querySelector('[data-nav="login"]');
	const existingLogout = nav.querySelector('[data-nav="logout"]');
	const existingAdmin = nav.querySelector('[data-nav="admin"]');

	if (existingLogin) existingLogin.remove();
	if (existingLogout) existingLogout.remove();
	if (existingAdmin) existingAdmin.remove();

	if (isAuthenticated()) {
		const adminLink = document.createElement("a");
		adminLink.setAttribute("data-nav", "admin");
		adminLink.href = "admin.html";
		adminLink.textContent = "Admin";
		nav.appendChild(adminLink);

		const logoutLink = document.createElement("a");
		logoutLink.setAttribute("data-nav", "logout");
		logoutLink.href = "#";
		logoutLink.textContent = "Logout";
		logoutLink.addEventListener("click", (event) => {
			event.preventDefault();
			clearAuthToken();
			window.location.href = "index.html";
		});
		nav.appendChild(logoutLink);
	} else {
		const loginLink = document.createElement("a");
		loginLink.setAttribute("data-nav", "login");
		loginLink.href = "login.html";
		loginLink.textContent = "Admin Login";
		nav.appendChild(loginLink);
	}
}

let reports = [];

function statusClass(status) {
	return status.toLowerCase().replace(" ", "-");
}

function formatReportDate(report) {
	if (!report.created_at) return report.date || "Date unavailable";
	return new Date(report.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function mapIssue(issue) {
	return {
		id: issue.id,
		title: issue.title,
		description: issue.description,
		category: issue.category,
		location: issue.location,
		reporter: issue.reporter_name,
		status: issue.status,
		created_at: issue.created_at
	};
}

function renderReports() {
	const list = document.querySelector("#reports-list");
	if (!list) return;

	const search = document.querySelector("#report-search").value.toLowerCase();
	const category = document.querySelector("#category-filter").value;
	const status = document.querySelector("#status-filter").value;
	const filteredReports = reports.filter((report) => {
		const searchable = `${report.title} ${report.description} ${report.location}`.toLowerCase();
		return searchable.includes(search) && (category === "all" || report.category === category) && (status === "all" || report.status === status);
	});

	list.innerHTML = filteredReports.map((report) => `<article class="report-card"><div class="report-card-top"><h3>${report.title}</h3><span class="status status-${statusClass(report.status)}">${report.status}</span></div><p>${report.description}</p><div class="report-meta"><span><strong>${report.category}</strong></span><span>${report.location}</span><span>By ${report.reporter}</span><span>${formatReportDate(report)}</span></div></article>`).join("");
	document.querySelector("#results-count").textContent = `${filteredReports.length} report${filteredReports.length === 1 ? "" : "s"}`;
	document.querySelector("#empty-reports").hidden = filteredReports.length !== 0;
}

async function loadReports() {
	const list = document.querySelector("#reports-list");
	const count = document.querySelector("#results-count");
	const emptyState = document.querySelector("#empty-reports");
	if (!list) return;

	count.textContent = "Loading...";
	emptyState.hidden = true;
	list.innerHTML = "<p class=\"empty-state\">Loading reports...</p>";

	try {
		const response = await fetch(`${API_BASE_URL}/issues`);
		if (!response.ok) throw new Error("Reports request failed");
		const issues = await response.json();
		reports = issues.map(mapIssue);
		renderReports();
	} catch (error) {
		list.innerHTML = "";
		count.textContent = "0 reports";
		emptyState.textContent = "Reports are unavailable right now. Please try again later.";
		emptyState.hidden = false;
	}
}

function renderAdminRows() {
	const list = document.querySelector("#admin-list");
	if (!list) return;
	list.innerHTML = reports.map((report) => `<tr><td>${report.title}</td><td>${report.category}</td><td>${report.location}</td><td>${report.reporter}</td><td><select aria-label="Status for ${report.title}" data-issue-id="${report.id}"><option ${report.status === "Pending" ? "selected" : ""}>Pending</option><option ${report.status === "In Progress" ? "selected" : ""}>In Progress</option><option ${report.status === "Resolved" ? "selected" : ""}>Resolved</option></select></td><td><button class="update-button" type="button">Update</button></td></tr>`).join("");
	list.onclick = async (event) => {
		if (!event.target.matches(".update-button")) return;
		const button = event.target;
		const select = button.closest("tr").querySelector("select");
		const issueId = select.dataset.issueId;
		const reportIndex = reports.findIndex((report) => String(report.id) === issueId);
		const previousStatus = reports[reportIndex]?.status;
		button.disabled = true;
		button.textContent = "Updating...";

		try {
			const response = await apiRequest(`/issues/${issueId}/status`, {
				method: "PATCH",
				body: JSON.stringify({ status: select.value })
			});
			if (!response.ok) throw new Error("Status update failed");
			const updatedIssue = await response.json();
			reports[reportIndex] = mapIssue(updatedIssue);
			renderAdminRows();
			const updatedButton = document.querySelector(`[data-issue-id="${issueId}"]`)?.closest("tr").querySelector(".update-button");
			if (updatedButton) {
				updatedButton.textContent = "Updated";
				updatedButton.classList.add("updated");
				window.setTimeout(() => { updatedButton.textContent = "Update"; updatedButton.classList.remove("updated"); }, 1600);
			}
		} catch (error) {
			select.value = previousStatus;
			button.disabled = false;
			button.textContent = "Try again";
			button.classList.remove("updated");
			window.setTimeout(() => { button.textContent = "Update"; }, 1600);
		}
	};
}

async function isAdmin() {
	const user = await refreshCurrentUser();
	return Boolean(user && user.role === "admin");
}

async function loadAdminIssues() {
	if (!(await isAdmin())) {
		window.location.href = "login.html";
		return;
	}

	const list = document.querySelector("#admin-list");
	if (!list) return;

	list.innerHTML = "<tr><td colspan=\"6\">Loading issues...</td></tr>";
	try {
		const response = await apiRequest("/issues");
		if (!response.ok) throw new Error("Admin issues request failed");
		const issues = await response.json();
		reports = issues.map(mapIssue);
		renderAdminRows();
		updateAdminStats(issues);
	} catch (error) {
		list.innerHTML = "<tr><td colspan=\"6\">Issues are unavailable right now. Please try again later.</td></tr>";
	}
}

function updateAdminStats(issues) {
	const totalEl = document.getElementById("stat-total");
	const pendingEl = document.getElementById("stat-pending");
	const progressEl = document.getElementById("stat-progress");
	const resolvedEl = document.getElementById("stat-resolved");
	if (!issues.length) {
		if (totalEl) totalEl.textContent = "0";
		if (pendingEl) pendingEl.textContent = "0";
		if (progressEl) progressEl.textContent = "0";
		if (resolvedEl) resolvedEl.textContent = "0";
		return;
	}
	const pending = issues.filter((issue) => issue.status === "Pending").length;
	const progress = issues.filter((issue) => issue.status === "In Progress").length;
	const resolved = issues.filter((issue) => issue.status === "Resolved").length;
	if (totalEl) totalEl.textContent = String(issues.length);
	if (pendingEl) pendingEl.textContent = String(pending);
	if (progressEl) progressEl.textContent = String(progress);
	if (resolvedEl) resolvedEl.textContent = String(resolved);
}

document.addEventListener("DOMContentLoaded", () => {
	const menuToggle = document.querySelector(".menu-toggle");
	const siteNav = document.querySelector(".site-nav");
	if (menuToggle) menuToggle.addEventListener("click", () => { const isOpen = siteNav.classList.toggle("open"); menuToggle.setAttribute("aria-expanded", isOpen); });
	document.querySelectorAll(".site-nav a").forEach((link) => link.addEventListener("click", () => siteNav?.classList.remove("open")));

	updateNavigationAuth();

	const loginForm = document.querySelector("#login-form");
	if (loginForm) {
		loginForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			const form = event.currentTarget;
			const message = document.querySelector("#login-message");
			if (!form.checkValidity()) {
				message.textContent = "Please complete every field before signing in.";
				form.reportValidity();
				return;
			}

			const payload = {
				email: document.querySelector("#login-email").value.trim(),
				password: document.querySelector("#login-password").value,
			};

			try {
				const response = await apiRequest("/auth/login", {
					method: "POST",
					body: JSON.stringify(payload),
				});

				if (response.ok) {
					const data = await response.json();
					setAuthToken(data.access_token);
					updateNavigationAuth();
					window.location.href = "admin.html";
					return;
				}

				if (response.status === 401) {
					message.textContent = "Invalid email or password.";
				} else if (response.status === 503) {
					message.textContent = "Authentication is temporarily unavailable. Please try again shortly.";
				} else {
					message.textContent = "We couldn't sign you in right now. Please try again.";
				}
			} catch {
				message.textContent = "We couldn't sign you in right now. Please try again.";
			}
		});
	}

	["#report-search", "#category-filter", "#status-filter"].forEach((selector) => document.querySelector(selector)?.addEventListener("input", renderReports));
	if (document.querySelector("#reports-list")) {
		loadReports();
	}
	if (document.querySelector("#admin-list")) {
		loadAdminIssues();
	}

	document.querySelector("#issue-form")?.addEventListener("submit", async (event) => {
		event.preventDefault();
		const form = event.currentTarget;
		const message = document.querySelector("#form-message");
		if (!form.checkValidity()) { message.textContent = "Please complete every field before submitting."; form.reportValidity(); return; }

		const payload = {
			title: document.querySelector("#issue-title").value.trim(),
			description: document.querySelector("#description").value.trim(),
			category: document.querySelector("#category").value,
			location: document.querySelector("#location").value.trim(),
			reporter_name: document.querySelector("#reporter").value.trim()
		};

		try {
			const response = await apiRequest("/issues", {
				method: "POST",
				body: JSON.stringify(payload)
			});

			if (response.ok) {
				message.textContent = "Your issue was submitted successfully.";
				form.reset();
				return;
			}

			if (response.status === 422) {
				message.textContent = "Please check your report details and try again.";
			} else if (response.status === 503) {
				message.textContent = "Issue reporting is temporarily unavailable. Please try again shortly.";
			} else {
				message.textContent = "We couldn't submit your report right now. Please try again.";
			}
		} catch (error) {
			message.textContent = "We couldn't submit your report right now. Please try again.";
		}
	});
});
