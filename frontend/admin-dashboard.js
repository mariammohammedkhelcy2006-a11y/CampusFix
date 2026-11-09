let adminReports = [];

function showAdminMessage(message, type = "") {
	const element = document.querySelector("#admin-message");
	element.textContent = message;
	element.className = `admin-message ${type}`.trim();
}

function safeCloudinaryImage(imageUrl, title) {
	try {
		const parsedUrl = new URL(imageUrl);
		if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "res.cloudinary.com") return null;
		const image = document.createElement("img");
		image.className = "admin-issue-image";
		image.src = parsedUrl.href;
		image.alt = `Photo for ${title}`;
		image.loading = "lazy";
		image.referrerPolicy = "no-referrer";
		image.addEventListener("error", () => image.remove());
		return image;
	} catch {
		return null;
	}
}

function updateAdminStats() {
	document.querySelector("#stat-total").textContent = String(adminReports.length);
	document.querySelector("#stat-pending").textContent = String(adminReports.filter((item) => item.status === "Pending").length);
	document.querySelector("#stat-progress").textContent = String(adminReports.filter((item) => item.status === "In Progress").length);
	document.querySelector("#stat-resolved").textContent = String(adminReports.filter((item) => item.status === "Resolved").length);
}

function makeReportRow(report) {
	const row = document.createElement("tr");
	const titleCell = document.createElement("td");
	const image = report.image_url ? safeCloudinaryImage(report.image_url, report.title) : null;
	if (image) titleCell.appendChild(image);
	const title = document.createElement("strong");
	title.textContent = report.title;
	titleCell.appendChild(title);
	row.appendChild(titleCell);

	[report.description, report.category, report.location, report.reporter_name].forEach((value) => {
		const cell = document.createElement("td");
		cell.textContent = value;
		row.appendChild(cell);
	});

	const dateCell = document.createElement("td");
	dateCell.textContent = report.created_at
		? new Date(report.created_at).toLocaleDateString()
		: "Date unavailable";
	row.appendChild(dateCell);

	const statusCell = document.createElement("td");
	const statusSelect = document.createElement("select");
	statusSelect.setAttribute("aria-label", `Status for ${report.title}`);
	statusSelect.dataset.issueId = String(report.id);
	["Pending", "In Progress", "Resolved"].forEach((status) => {
		const option = document.createElement("option");
		option.value = status;
		option.textContent = status;
		option.selected = report.status === status;
		statusSelect.appendChild(option);
	});
	statusCell.appendChild(statusSelect);
	row.appendChild(statusCell);

	const actionCell = document.createElement("td");
	const actions = document.createElement("div");
	actions.className = "admin-actions";
	const updateButton = document.createElement("button");
	updateButton.className = "update-button";
	updateButton.type = "button";
	updateButton.dataset.action = "update";
	updateButton.dataset.issueId = String(report.id);
	updateButton.textContent = "Update";
	const deleteButton = document.createElement("button");
	deleteButton.className = "delete-button";
	deleteButton.type = "button";
	deleteButton.dataset.action = "delete";
	deleteButton.dataset.issueId = String(report.id);
	deleteButton.textContent = "Delete";
	deleteButton.setAttribute("aria-label", `Delete ${report.title}`);
	actions.append(updateButton, deleteButton);
	actionCell.appendChild(actions);
	row.appendChild(actionCell);
	return row;
}

function renderAdminReports() {
	const category = document.querySelector("#admin-category-filter").value;
	const status = document.querySelector("#admin-status-filter").value;
	const visibleReports = adminReports.filter((report) =>
		(category === "all" || report.category === category)
		&& (status === "all" || report.status === status));
	const list = document.querySelector("#admin-list");
	if (visibleReports.length === 0) {
		const row = document.createElement("tr");
		const cell = document.createElement("td");
		cell.colSpan = 8;
		cell.textContent = adminReports.length ? "No reports match these filters." : "No reports have been submitted yet.";
		row.appendChild(cell);
		list.replaceChildren(row);
		return;
	}
	list.replaceChildren(...visibleReports.map(makeReportRow));
}

async function loadAdminReports() {
	const list = document.querySelector("#admin-list");
	list.replaceChildren();
	showAdminMessage("Loading reports...");
	try {
		const response = await fetch("/api/admin/issues", { cache: "no-store" });
		if (response.status === 401 || response.status === 403) {
			window.location.replace("/control-panel");
			return;
		}
		if (!response.ok) throw new Error("Reports could not be loaded");
		adminReports = await response.json();
		updateAdminStats();
		renderAdminReports();
		showAdminMessage(`${adminReports.length} report${adminReports.length === 1 ? "" : "s"} loaded.`, "success");
	} catch {
		showAdminMessage("Reports are unavailable right now. Please try again.", "error");
	}
}

async function updateReportStatus(button) {
	const issueId = button.dataset.issueId;
	const select = button.closest("tr").querySelector("select");
	button.disabled = true;
	button.textContent = "Updating...";
	try {
		const response = await fetch(`/api/admin/issues/${issueId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: select.value }),
		});
		if (response.status === 401 || response.status === 403) {
			window.location.replace("/control-panel");
			return;
		}
		if (!response.ok) throw new Error("Status update failed");
		const updatedReport = await response.json();
		adminReports = adminReports.map((item) => item.id === updatedReport.id ? updatedReport : item);
		updateAdminStats();
		renderAdminReports();
		showAdminMessage(`Status updated for "${updatedReport.title}".`, "success");
	} catch {
		showAdminMessage("The report status could not be updated. Please try again.", "error");
	} finally {
		button.disabled = false;
		button.textContent = "Update";
	}
}

async function deleteReport(button) {
	const issueId = button.dataset.issueId;
	const report = adminReports.find((item) => String(item.id) === issueId);
	if (!report || !window.confirm(`Delete "${report.title}"? This action cannot be undone.`)) return;
	button.disabled = true;
	button.textContent = "Deleting...";
	try {
		const response = await fetch(`/api/admin/issues/${issueId}`, { method: "DELETE" });
		if (response.status === 401 || response.status === 403) {
			window.location.replace("/control-panel");
			return;
		}
		if (!response.ok) throw new Error("Delete request failed");
		const result = await response.json();
		if (result.deleted !== true) throw new Error("Deletion was not confirmed");
		adminReports = adminReports.filter((item) => String(item.id) !== issueId);
		updateAdminStats();
		renderAdminReports();
		showAdminMessage(`"${report.title}" was deleted.`, "success");
	} catch {
		showAdminMessage("The report could not be deleted. Please try again.", "error");
	} finally {
		button.disabled = false;
		button.textContent = "Delete";
	}
}

document.addEventListener("DOMContentLoaded", () => {
	const menuToggle = document.querySelector(".menu-toggle");
	const sidebar = document.querySelector(".admin-sidebar");
	menuToggle.addEventListener("click", () => {
		const isOpen = sidebar.classList.toggle("open");
		menuToggle.setAttribute("aria-expanded", String(isOpen));
	});
	document.querySelector("#refresh-admin").addEventListener("click", loadAdminReports);
	document.querySelector("#admin-category-filter").addEventListener("change", renderAdminReports);
	document.querySelector("#admin-status-filter").addEventListener("change", renderAdminReports);
	document.querySelector("#admin-list").addEventListener("click", (event) => {
		const button = event.target.closest("button[data-action]");
		if (!button) return;
		if (button.dataset.action === "update") updateReportStatus(button);
		if (button.dataset.action === "delete") deleteReport(button);
	});
	document.querySelector("#admin-logout").addEventListener("click", async () => {
		const button = document.querySelector("#admin-logout");
		button.disabled = true;
		try {
			const response = await fetch("/api/admin/logout", { method: "POST" });
			if (!response.ok) throw new Error("Logout could not be confirmed");
			window.location.replace("/control-panel");
		} catch {
			button.disabled = false;
			showAdminMessage("Secure logout could not be confirmed. Please try again.", "error");
		}
	});
	loadAdminReports();
});
