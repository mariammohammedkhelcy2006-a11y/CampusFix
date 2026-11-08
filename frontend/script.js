const API_BASE_URL = "https://campusfix-ixxc.onrender.com";

const AUTH_TOKEN_KEY = "campusfix_access_token";
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
let selectedPhotoFile = null;
let selectedPhotoPreviewUrl = null;

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
		image_url: issue.image_url,
		status: issue.status,
		created_at: issue.created_at
	};
}

function createIssueImage(imageUrl, altText, className) {
	if (!imageUrl) return null;

	let parsedUrl;
	try {
		parsedUrl = new URL(imageUrl);
	} catch {
		return null;
	}
	if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "res.cloudinary.com") return null;

	const image = document.createElement("img");
	image.className = className;
	image.src = imageUrl;
	image.alt = altText;
	image.loading = "lazy";
	image.referrerPolicy = "no-referrer";
	image.addEventListener("error", () => image.remove());
	return image;
}

function createStatusBadge(status) {
	const badge = document.createElement("span");
	badge.classList.add("status", `status-${statusClass(status)}`);
	badge.textContent = status;
	return badge;
}

function createReportCard(report) {
	const card = document.createElement("article");
	card.className = "report-card";

	const cardTop = document.createElement("div");
	cardTop.className = "report-card-top";
	const title = document.createElement("h3");
	title.textContent = report.title;
	cardTop.append(title, createStatusBadge(report.status));

	const description = document.createElement("p");
	description.textContent = report.description;
	const issueImage = createIssueImage(report.image_url, `Photo for ${report.title}`, "report-image");

	const meta = document.createElement("div");
	meta.className = "report-meta";
	const category = document.createElement("span");
	const categoryLabel = document.createElement("strong");
	categoryLabel.textContent = report.category;
	category.appendChild(categoryLabel);
	const location = document.createElement("span");
	location.textContent = report.location;
	const reporter = document.createElement("span");
	reporter.textContent = `By ${report.reporter}`;
	const date = document.createElement("span");
	date.textContent = formatReportDate(report);
	meta.append(category, location, reporter, date);

	card.append(cardTop);
	if (issueImage) card.appendChild(issueImage);
	card.append(description, meta);
	return card;
}

function createAdminMessage(message) {
	const row = document.createElement("tr");
	const cell = document.createElement("td");
	cell.colSpan = 6;
	cell.textContent = message;
	row.appendChild(cell);
	return row;
}

function createAdminRow(report) {
	const row = document.createElement("tr");
	const titleCell = document.createElement("td");
	const issueImage = createIssueImage(report.image_url, `Photo for ${report.title}`, "admin-issue-image");
	if (issueImage) {
		const summary = document.createElement("div");
		summary.className = "admin-issue-summary";
		const title = document.createElement("span");
		title.textContent = report.title;
		summary.append(issueImage, title);
		titleCell.appendChild(summary);
	} else {
		titleCell.textContent = report.title;
	}
	row.appendChild(titleCell);

	[report.category, report.location, report.reporter].forEach((value) => {
		const cell = document.createElement("td");
		cell.textContent = value;
		row.appendChild(cell);
	});

	const statusCell = document.createElement("td");
	const select = document.createElement("select");
	select.setAttribute("aria-label", `Status for ${report.title}`);
	select.dataset.issueId = String(report.id);
	["Pending", "In Progress", "Resolved"].forEach((status) => {
		const option = document.createElement("option");
		option.value = status;
		option.textContent = status;
		option.selected = report.status === status;
		select.appendChild(option);
	});
	statusCell.appendChild(select);

	const actionCell = document.createElement("td");
	const updateButton = document.createElement("button");
	updateButton.className = "update-button";
	updateButton.type = "button";
	updateButton.textContent = "Update";
	const deleteButton = document.createElement("button");
	deleteButton.className = "delete-button";
	deleteButton.type = "button";
	deleteButton.dataset.issueId = String(report.id);
	deleteButton.setAttribute("aria-label", `Delete ${report.title}`);
	deleteButton.textContent = "Delete";
	const actions = document.createElement("div");
	actions.className = "admin-actions";
	actions.append(updateButton, deleteButton);
	actionCell.appendChild(actions);

	row.append(statusCell, actionCell);
	return row;
}

function setAdminMessage(message, type = "") {
	const adminMessage = document.querySelector("#admin-message");
	if (!adminMessage) return;
	adminMessage.textContent = message;
	adminMessage.className = `admin-message ${type}`.trim();
}

function setPhotoMessage(message) {
	const photoMessage = document.querySelector("#photo-message");
	if (photoMessage) photoMessage.textContent = message;
}

function clearSelectedPhoto(clearMessage = true) {
	if (selectedPhotoPreviewUrl) URL.revokeObjectURL(selectedPhotoPreviewUrl);
	selectedPhotoFile = null;
	selectedPhotoPreviewUrl = null;
	const photoInput = document.querySelector("#issue-photo");
	const preview = document.querySelector("#photo-preview");
	const previewImage = document.querySelector("#photo-preview-image");
	if (photoInput) photoInput.value = "";
	if (previewImage) previewImage.removeAttribute("src");
	if (preview) preview.hidden = true;
	if (clearMessage) setPhotoMessage("");
}

function showSelectedPhoto(file) {
	if (selectedPhotoPreviewUrl) URL.revokeObjectURL(selectedPhotoPreviewUrl);
	selectedPhotoFile = file;
	selectedPhotoPreviewUrl = URL.createObjectURL(file);
	const preview = document.querySelector("#photo-preview");
	const previewImage = document.querySelector("#photo-preview-image");
	if (previewImage) previewImage.src = selectedPhotoPreviewUrl;
	if (preview) preview.hidden = false;
	setPhotoMessage("");
}

function validateSelectedPhoto(file) {
	if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
		setPhotoMessage("Choose a JPEG, PNG, or WEBP image.");
		return false;
	}
	if (file.size > MAX_PHOTO_SIZE_BYTES) {
		setPhotoMessage("Choose an image that is 5 MB or smaller.");
		return false;
	}
	return true;
}

async function uploadIssuePhoto(file) {
	const formData = new FormData();
	formData.append("file", file);
	let response;
	try {
		response = await fetch(`${API_BASE_URL}/uploads/images`, {
			method: "POST",
			body: formData,
		});
	} catch {
		const error = new Error("Photo upload failed");
		error.isPhotoUpload = true;
		throw error;
	}
	if (response.ok) return response.json();

	const error = new Error("Photo upload failed");
	error.status = response.status;
	error.isPhotoUpload = true;
	throw error;
}

function photoUploadErrorMessage(status) {
	if (status === 413) return "Choose an image that is 5 MB or smaller.";
	if (status === 422) return "Choose a valid JPEG, PNG, or WEBP image.";
	if (status === 503) return "Photo uploads are temporarily unavailable. You can still submit the report without a photo.";
	return "We couldn't upload that photo. Please try again or submit the report without it.";
}

function renderReports() {
	const list = document.querySelector("#reports-list");
	if (!list) return;

	const search = document.querySelector("#report-search")?.value.toLowerCase() || "";
	const category = document.querySelector("#category-filter")?.value || "all";
	const status = document.querySelector("#status-filter")?.value || "all";
	const filteredReports = reports.filter((report) => {
		const searchable = `${report.title} ${report.description} ${report.location}`.toLowerCase();
		return searchable.includes(search) && (category === "all" || report.category === category) && (status === "all" || report.status === status);
	});

	const limit = Number(list.dataset.limit) || filteredReports.length;
	const visibleReports = filteredReports.slice(0, limit);
	list.replaceChildren(...visibleReports.map(createReportCard));
	const count = document.querySelector("#results-count");
	const emptyState = document.querySelector("#empty-reports");
	if (count) {
		count.textContent = list.dataset.limit
			? `${visibleReports.length} recent report${visibleReports.length === 1 ? "" : "s"}`
			: `${filteredReports.length} report${filteredReports.length === 1 ? "" : "s"}`;
	}
	if (emptyState) emptyState.hidden = visibleReports.length !== 0;
}

async function loadReports() {
	const list = document.querySelector("#reports-list");
	const count = document.querySelector("#results-count");
	const emptyState = document.querySelector("#empty-reports");
	if (!list) return;

	count.textContent = "Loading...";
	emptyState.hidden = true;
	const loadingMessage = document.createElement("p");
	loadingMessage.className = "empty-state";
	loadingMessage.textContent = "Loading reports...";
	list.replaceChildren(loadingMessage);

	try {
		const response = await fetch(`${API_BASE_URL}/issues`);
		if (!response.ok) throw new Error("Reports request failed");
		const issues = await response.json();
		reports = issues.map(mapIssue);
		renderReports();
	} catch (error) {
		list.replaceChildren();
		count.textContent = "0 reports";
		emptyState.textContent = "Reports are unavailable right now. Please try again later.";
		emptyState.hidden = false;
	}
}

function renderAdminRows() {
	const list = document.querySelector("#admin-list");
	if (!list) return;
	list.replaceChildren(...reports.map(createAdminRow));
	list.onclick = async (event) => {
		const button = event.target.closest("button");
		if (!button) return;
		if (button.matches(".delete-button")) {
			await deleteAdminIssue(button);
			return;
		}
		if (!button.matches(".update-button")) return;
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

async function deleteAdminIssue(button) {
	const issueId = button.dataset.issueId;
	const report = reports.find((item) => String(item.id) === issueId);
	if (!report) {
		setAdminMessage("This report is no longer available. Refresh the dashboard and try again.", "error");
		return;
	}
	if (!window.confirm(`Delete "${report.title}"? This action cannot be undone.`)) return;

	button.disabled = true;
	button.textContent = "Deleting...";
	setAdminMessage("");
	let deletionConfirmed = false;
	let responseMessage = "";
	let cleanupStatus = "not_required";
	let timeoutId;
	const controller = new AbortController();
	try {
		timeoutId = window.setTimeout(() => controller.abort(), 30000);
		const response = await apiRequest(`/issues/${issueId}`, {
			method: "DELETE",
			signal: controller.signal,
		});
		if (!response.ok) {
			const messages = {
				401: "Your session has expired. Please sign in again.",
				403: "Administrator access is required to delete reports.",
				404: "This report was already deleted or no longer exists.",
				405: "The server does not currently support report deletion. The backend may need its latest update.",
			};
			responseMessage = messages[response.status] || `The report could not be deleted (server error ${response.status}). Please try again.`;
			throw new Error("Delete request failed");
		}

		const result = await response.json();
		if (result.deleted !== true) {
			throw new Error("The server did not confirm report deletion");
		}

		deletionConfirmed = true;
		cleanupStatus = result.image_cleanup || "not_required";
		reports = reports.filter((item) => String(item.id) !== issueId);
		renderAdminRows();
		updateAdminStats(reports);
	} catch (error) {
		if (!responseMessage) {
			responseMessage = error.name === "AbortError"
				? "The delete request timed out. The server may still be processing it; refresh the dashboard before retrying."
				: "The delete request could not reach the server. Check that the latest backend is deployed and try again.";
		}
	} finally {
		window.clearTimeout(timeoutId);
		button.disabled = false;
		button.textContent = "Delete";
	}

	if (!deletionConfirmed) {
		setAdminMessage(responseMessage || "The report could not be deleted. Please try again.", "error");
		return;
	}

	const cleanupMessages = {
		not_required: "Report deleted successfully.",
		deleted: "Report and its photo deleted successfully.",
		shared: "Report deleted successfully. Its photo is still used by another report, so it was kept.",
		failed: "Report deleted, but its photo could not be removed. Please contact an administrator.",
	};
	const message = cleanupMessages[cleanupStatus] || "Report deleted successfully.";
	setAdminMessage(message, cleanupStatus === "failed" ? "error" : "success");
	const refreshed = await loadAdminIssues();
	if (!refreshed) {
		setAdminMessage(`${message} The dashboard could not refresh; reload the page to see the latest reports.`, "error");
	}
}

async function isAdmin() {
	const user = await refreshCurrentUser();
	return Boolean(user && user.role === "admin");
}

async function loadAdminIssues() {
	if (!(await isAdmin())) {
		window.location.href = "login.html";
		return false;
	}

	const list = document.querySelector("#admin-list");
	if (!list) return false;

	list.replaceChildren(createAdminMessage("Loading issues..."));
	try {
		const response = await apiRequest("/issues");
		if (!response.ok) throw new Error("Admin issues request failed");
		const issues = await response.json();
		reports = issues.map(mapIssue);
		renderAdminRows();
		updateAdminStats(issues);
		return true;
	} catch (error) {
		list.replaceChildren(createAdminMessage("Issues are unavailable right now. Please try again later."));
		return false;
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

	document.querySelectorAll(".category-card[data-category]").forEach((card) => {
		card.addEventListener("click", () => {
			const category = document.querySelector("#category");
			if (category) category.value = card.dataset.category;
		});
	});

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

	const photoInput = document.querySelector("#issue-photo");
	if (photoInput) {
		photoInput.addEventListener("change", (event) => {
			const file = event.target.files?.[0];
			if (!file) return;
			if (!validateSelectedPhoto(file)) {
				clearSelectedPhoto(false);
				return;
			}
			showSelectedPhoto(file);
		});
	}
	document.querySelector("#remove-photo")?.addEventListener("click", clearSelectedPhoto);

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
			if (selectedPhotoFile) {
				message.textContent = "Uploading photo...";
				const uploadedPhoto = await uploadIssuePhoto(selectedPhotoFile);
				payload.image_url = uploadedPhoto.image_url;
			}

			const response = await apiRequest("/issues", {
				method: "POST",
				body: JSON.stringify(payload)
			});

			if (response.ok) {
				form.reset();
				clearSelectedPhoto();
				message.textContent = "Your issue was submitted successfully.";
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
			if (error.isPhotoUpload) {
				const photoError = photoUploadErrorMessage(error.status);
				setPhotoMessage(photoError);
				message.textContent = photoError;
				return;
			}
			message.textContent = "We couldn't submit your report right now. Please try again.";
		}
	});
});
